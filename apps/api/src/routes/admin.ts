import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { setRoleSchema } from '@fsp/shared';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { requireRole } from '../auth/context.js';
import {
  decideClaim,
  listAccounts,
  listPendingClaims,
  setAccountRole,
} from '../services/accounts.js';
import { auditLog, venues } from '../db/schema.js';
import type { AppContext } from './context.js';

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/accounts', async (request) => {
    requireRole(request, 'admin');
    return { accounts: await listAccounts(db) };
  });

  app.put<{ Params: { id: string } }>('/api/admin/accounts/:id/role', async (request) => {
    const viewer = requireRole(request, 'admin');
    const body = parse(setRoleSchema, request.body);
    await setAccountRole(db, request.params.id, body.role, viewer);
    return { ok: true };
  });

  /** Заявки на привязку DUPR ID разбирает любой организатор. */
  app.get('/api/claims', async (request) => {
    requireRole(request, 'moderator');
    return { claims: await listPendingClaims(db) };
  });

  app.post<{ Params: { id: string } }>('/api/claims/:id/decision', async (request) => {
    const viewer = requireRole(request, 'moderator');
    const body = parse(z.object({ approve: z.boolean() }), request.body);
    await decideClaim(db, request.params.id, body.approve, viewer);
    return { ok: true };
  });

  app.get('/api/admin/audit', async (request) => {
    requireRole(request, 'admin');
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);
    return {
      entries: rows.map((row) => ({
        id: row.id,
        actorName: row.actorName,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        tournamentId: row.tournamentId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.get('/api/venues', async () => {
    const rows = await db.select().from(venues).orderBy(desc(venues.createdAt));
    return {
      venues: rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        mapUrl: row.mapUrl,
      })),
    };
  });

  app.post('/api/venues', async (request, reply) => {
    requireRole(request, 'moderator');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(160),
        address: z.string().trim().max(400).nullable().optional(),
        mapUrl: z.string().url().max(500).nullable().optional(),
      }),
      request.body,
    );
    const [row] = await db
      .insert(venues)
      .values({
        name: body.name,
        address: body.address ?? null,
        mapUrl: body.mapUrl ?? null,
      })
      .returning();
    reply.code(201);
    return { venue: row };
  });

  app.delete<{ Params: { id: string } }>('/api/venues/:id', async (request) => {
    requireRole(request, 'admin');
    await db.delete(venues).where(eq(venues.id, request.params.id));
    return { ok: true };
  });
}
