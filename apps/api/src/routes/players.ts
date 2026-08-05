import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createPlayerSchema,
  importPlayersSchema,
  mergeGuestSchema,
  updatePlayerSchema,
  updateRatingSchema,
} from '@fsp/shared';
import { parse } from '../lib/validate.js';
import { requireRole, requireViewer } from '../auth/context.js';
import {
  createPlayer,
  mergeGuestIntoDupr,
  resolveRatingConflict,
  searchPlayers,
  setDoublesRating,
  updatePlayer,
} from '../services/players.js';
import { getPlayerProfile } from '../services/stats.js';
import { createInvite } from '../services/accounts.js';
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
  const { db, env } = ctx;

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
    );
    return { invite };
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
