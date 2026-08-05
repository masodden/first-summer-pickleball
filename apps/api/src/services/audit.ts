import type { Database } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import type { Viewer } from '../auth/context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  tournamentId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Журнал действий. Нужен, чтобы после турнира можно было понять, кто и когда
 * менял счёт или состав — иначе спорные ситуации не разобрать.
 */
export async function recordAudit(
  db: Database,
  actor: Viewer | null,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLog).values({
    accountId: actor?.accountId ?? null,
    actorName: actor?.displayName ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    tournamentId: entry.tournamentId ?? null,
    payload: entry.payload ?? null,
  });
}
