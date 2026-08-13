import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createPlayerSchema,
  importPlayersSchema,
  mergeGuestSchema,
  setRoleSchema,
  updatePlayerSchema,
  updateRatingSchema,
} from '@fsp/shared/schemas';
import { parse } from '../lib/validate.js';
import { requireRole, requireViewer } from '../auth/context.js';
import { ApiError, notFound } from '../lib/errors.js';
import { accounts } from '../db/schema.js';
import {
  createPlayer,
  deletePlayer,
  getPlayerRow,
  mergeGuestIntoDupr,
  resolveRatingConflict,
  searchPlayers,
  setDoublesRating,
  updatePlayer,
} from '../services/players.js';
import { getPlayerProfile } from '../services/stats.js';
import { createInvite, setPlayerClubRole } from '../services/accounts.js';
import { importDirectory, parseDirectory } from '../services/directory-import.js';
import type { AppContext } from './context.js';

const searchQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  includeGuests: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export function registerPlayerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, env, notify } = ctx;

  app.get('/api/players', async (request) => {
    const query = parse(searchQuerySchema, request.query ?? {});
    const items = await searchPlayers(db, {
      ...(query.query !== undefined ? { query: query.query } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      includeGuests: query.includeGuests,
    });
    return { items, total: items.length };
  });

  app.post('/api/players', async (request, reply) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(createPlayerSchema, request.body);
    const player = await createPlayer(db, body, viewer);
    reply.code(201);
    return { player };
  });

  app.get<{ Params: { id: string } }>('/api/players/:id', async (request) => {
    return getPlayerProfile(db, request.params.id, request.viewer);
  });

  app.patch<{ Params: { id: string } }>('/api/players/:id', async (request) => {
    const viewer = requireViewer(request);
    const body = parse(updatePlayerSchema, request.body ?? {});
    const player = await updatePlayer(db, request.params.id, body, viewer);
    return { player };
  });

  app.delete<{ Params: { id: string } }>('/api/players/:id', async (request) => {
    const viewer = requireRole(request, 'admin');
    await deletePlayer(db, request.params.id, viewer);
    return { ok: true };
  });

  /** Роль клуба на карточке DUPR — Telegram не обязателен. */
  app.put<{ Params: { id: string } }>('/api/players/:id/role', async (request) => {
    const viewer = requireRole(request, 'admin');
    const body = parse(setRoleSchema, request.body);
    await setPlayerClubRole(db, request.params.id, body.role, viewer);
    return { ok: true };
  });

  /**
   * Ручное ведение парного рейтинга: игрок правит себя, организатор — любого.
   * Отдельный маршрут, чтобы историю можно было писать точно и без лишних полей.
   */
  app.put<{ Params: { id: string } }>('/api/players/:id/rating', async (request) => {
    const viewer = requireViewer(request);
    const body = parse(updateRatingSchema, request.body);
    const player = await setDoublesRating(db, request.params.id, body.doublesRating, viewer);
    return { player };
  });

  app.post<{ Params: { id: string } }>('/api/players/:id/rating-conflict', async (request) => {
    const viewer = requireViewer(request);
    const body = parse(z.object({ accept: z.boolean() }), request.body);
    const player = await resolveRatingConflict(db, request.params.id, body.accept, viewer);
    return { player };
  });

  app.post<{ Params: { id: string } }>('/api/players/:id/merge', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(mergeGuestSchema, request.body);
    const player = await mergeGuestIntoDupr(db, request.params.id, body.duprId, viewer);
    return { player };
  });

  app.post<{ Params: { id: string } }>('/api/players/:id/invite', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const invite = await createInvite(
      db,
      request.params.id,
      viewer,
      env.TELEGRAM_BOT_USERNAME,
      env.PUBLIC_WEB_URL,
      env.TELEGRAM_MINI_APP_SHORT_NAME,
    );
    return { invite };
  });

  /**
   * Игрок привязал Telegram, но без @username — в t.me/… не перейти.
   * Шлём в бот просьбу написать организатору.
   */
  app.post<{ Params: { id: string } }>('/api/players/:id/nudge-contact', async (request) => {
    requireRole(request, 'moderator');
    const player = await getPlayerRow(db, request.params.id);
    if (player.telegramUsername) {
      throw new ApiError('validation_failed', 'У игрока уже указан Telegram username');
    }

    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.playerId, player.id))
      .limit(1);
    if (!account) {
      throw notFound('К этой карточке не привязан Telegram');
    }

    const contact = env.CLUB_CONTACT_TELEGRAM;
    await notify.sendToPlayers(
      [player.id],
      [
        'У вас не указан публичный username в Telegram (@ник), поэтому организаторы не могут написать вам в личные сообщения.',
        '',
        `Пожалуйста, напишите @${contact} для регистрации на турнир — или задайте username в настройках Telegram (Настройки → Имя пользователя).`,
      ].join('\n'),
    );
    return { ok: true, contactTelegram: contact };
  });

  /** Загрузка справочника DUPR: сопоставление по DUPR ID, ручные правки не трутся. */
  app.post('/api/players/import', async (request) => {
    const viewer = requireRole(request, 'admin');
    const body = parse(importPlayersSchema, request.body);
    const entries = parseDirectory(body.content);
    const report = await importDirectory(db, entries, {
      accountId: viewer.accountId,
      actorName: viewer.displayName,
    });
    return { report };
  });
}
