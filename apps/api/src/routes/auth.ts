import type { FastifyInstance } from 'fastify';
import { claimSchema, localeSchema, updateSettingsSchema } from '@fsp/shared';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { verifyInitData } from '../auth/telegram.js';
import { requireViewer } from '../auth/context.js';
import {
  buildSession,
  claimDuprId,
  devLogin,
  ensureGuestPlayerForAccount,
  getAccount,
  loginWithTelegram,
  syncPlayerProfileFromTelegram,
  updateAccountSettings,
  useInvite,
} from '../services/accounts.js';
import { updatePlayer } from '../services/players.js';
import type { AppContext } from './context.js';

const devLoginSchema = z.object({
  name: z.string().trim().min(1).max(60).default('Локальный организатор'),
  role: z.enum(['admin', 'moderator', 'organizer', 'user']).default('admin'),
  telegramId: z.string().trim().min(1).max(32).default('dev-1'),
});

const settingsSchema = updateSettingsSchema.extend({
  notificationsEnabled: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  locale: localeSchema.optional(),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, env } = ctx;

  app.post('/api/auth/telegram', async (request) => {
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new ApiError(
        'internal',
        'На сервере не задан TELEGRAM_BOT_TOKEN, вход через Telegram недоступен',
      );
    }
    const body = parse(z.object({ initData: z.string().min(1) }), request.body);
    const verified = verifyInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
    let account = await loginWithTelegram(db, verified);

    // Ссылка-приглашение может приехать прямо в deep-link Mini App.
    const startParam = verified.startParam;
    if (startParam?.startsWith('invite_')) {
      const session = await useInvite(db, startParam.slice('invite_'.length), account);
      account = await getAccount(db, account.id);
      await syncPlayerProfileFromTelegram(db, account);
      return {
        token: app.jwt.sign({ sub: account.id }),
        session: await buildSession(db, account),
      };
    }

    account = await ensureGuestPlayerForAccount(db, account);
    await syncPlayerProfileFromTelegram(db, account);
    return {
      token: app.jwt.sign({ sub: account.id }),
      session: await buildSession(db, account),
    };
  });

  app.post('/api/auth/dev', async (request) => {
    if (!env.ALLOW_DEV_LOGIN) {
      throw new ApiError('forbidden', 'Локальный вход выключен');
    }
    const body = parse(devLoginSchema, request.body ?? {});
    let account = await devLogin(db, {
      telegramId: body.telegramId,
      name: body.name,
      role: body.role,
    });
    account = await ensureGuestPlayerForAccount(db, account);
    await syncPlayerProfileFromTelegram(db, account);
    return {
      token: app.jwt.sign({ sub: account.id }),
      session: await buildSession(db, account),
    };
  });

  app.get('/api/auth/session', async (request) => {
    if (!request.viewer) return { session: null };
    let account = await getAccount(db, request.viewer.accountId);
    account = await ensureGuestPlayerForAccount(db, account);
    await syncPlayerProfileFromTelegram(db, account);
    return { session: await buildSession(db, account) };
  });

  app.post('/api/auth/claim', async (request) => {
    const viewer = requireViewer(request);
    const body = parse(claimSchema, request.body);
    const account = await getAccount(db, viewer.accountId);
    const bootstrapCode = env.ALLOW_DEV_LOGIN ? null : env.BOOTSTRAP_ADMIN_CODE;
    return { session: await claimDuprId(db, account, body, bootstrapCode) };
  });

  app.post<{ Params: { token: string } }>('/api/auth/invite/:token', async (request) => {
    const viewer = requireViewer(request);
    const account = await getAccount(db, viewer.accountId);
    return { session: await useInvite(db, request.params.token, account) };
  });

  app.patch('/api/me/settings', async (request) => {
    const viewer = requireViewer(request);
    const body = parse(settingsSchema, request.body ?? {});

    const accountPatch: Parameters<typeof updateAccountSettings>[2] = {};
    if (body.locale !== undefined) accountPatch.locale = body.locale;
    if (body.notificationsEnabled !== undefined) {
      accountPatch.notificationsEnabled = body.notificationsEnabled;
    }
    if (body.reducedMotion !== undefined) accountPatch.reducedMotion = body.reducedMotion;

    const account = await updateAccountSettings(db, viewer.accountId, accountPatch);

    // Имя и аватар живут в карточке игрока, а не в аккаунте.
    if (
      account.playerId &&
      (body.firstName !== undefined || body.lastName !== undefined || body.avatarUrl !== undefined)
    ) {
      await updatePlayer(
        db,
        account.playerId,
        {
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        },
        viewer,
      );
    }

    return { session: await buildSession(db, account) };
  });
}
