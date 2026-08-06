import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { isRoleAtLeast, type Locale, type Role } from '@fsp/shared';
import { accounts, players } from '../db/schema.js';
import type { Database } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { effectiveRole } from '../services/accounts.js';

/** Кто выполняет запрос. Наблюдатель без входа — это просто `null`. */
export interface Viewer {
  accountId: string;
  role: Role;
  playerId: string | null;
  locale: Locale;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    viewer: Viewer | null;
  }
}

export interface SessionTokenPayload {
  sub: string;
}

export function registerViewerContext(app: FastifyInstance, db: Database): void {
  app.decorateRequest('viewer', null);

  app.addHook('onRequest', async (request) => {
    // Bearer — обычные запросы; ?token= — скачивание файла из Telegram Mini App
    // (downloadFile ходит на URL без заголовка Authorization).
    const header = request.headers.authorization;
    const queryToken =
      typeof request.query === 'object' &&
      request.query !== null &&
      'token' in request.query &&
      typeof (request.query as { token?: unknown }).token === 'string'
        ? (request.query as { token: string }).token
        : null;
    const rawToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : queryToken;
    if (!rawToken) return;

    try {
      const payload = await request.server.jwt.verify<SessionTokenPayload>(rawToken);
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, payload.sub))
        .limit(1);
      if (!account) return;

      let player = null;
      if (account.playerId) {
        const [row] = await db
          .select()
          .from(players)
          .where(eq(players.id, account.playerId))
          .limit(1);
        player = row ?? null;
      }

      request.viewer = {
        accountId: account.id,
        role: effectiveRole(account, player),
        playerId: account.playerId,
        locale: account.locale,
        displayName:
          [account.telegramFirstName, account.telegramLastName].filter(Boolean).join(' ') ||
          account.telegramUsername ||
          'Пользователь',
      };
    } catch {
      // Плохой или просроченный токен — просто остаёмся наблюдателем.
    }
  });
}

export function requireViewer(request: FastifyRequest): Viewer {
  if (!request.viewer) throw unauthorized();
  return request.viewer;
}

export function requireRole(request: FastifyRequest, role: Role): Viewer {
  const viewer = requireViewer(request);
  if (!isRoleAtLeast(viewer.role, role)) throw forbidden();
  return viewer;
}

export function canManageTournaments(viewer: Viewer | null): boolean {
  return isRoleAtLeast(viewer?.role, 'moderator');
}

/** Тренировки: организатор, модератор и админ. */
export function canManageTrainings(viewer: Viewer | null): boolean {
  return isRoleAtLeast(viewer?.role, 'organizer');
}

export function isAdmin(viewer: Viewer | null): boolean {
  return viewer?.role === 'admin';
}
