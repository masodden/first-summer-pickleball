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
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    try {
      const payload = await request.jwtVerify<SessionTokenPayload>();
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

export function isAdmin(viewer: Viewer | null): boolean {
  return viewer?.role === 'admin';
}
