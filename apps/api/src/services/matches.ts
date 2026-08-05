import { and, asc, eq } from 'drizzle-orm';
import { courtLabel, type MatchDto, type MatchStatus } from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  matchPlayers,
  matches,
  players,
  tournaments,
  type MatchRow,
  type TournamentRow,
} from '../db/schema.js';
import { ApiError, conflictVersion, forbidden, notFound, wrongStatus } from '../lib/errors.js';
import { toPlayerDto } from './mappers.js';
import { canManageTournaments, type Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';

export async function loadMatchDto(db: Database, matchId: string): Promise<MatchDto> {
  const [row] = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw notFound('Матч не найден');

  const lineup = await db
    .select({ entry: matchPlayers, player: players })
    .from(matchPlayers)
    .innerJoin(players, eq(players.id, matchPlayers.playerId))
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.slot));

  const teamA = lineup
    .filter((item) => item.entry.team === 'A')
    .map((item) => toPlayerDto(item.player));
  const teamB = lineup
    .filter((item) => item.entry.team === 'B')
    .map((item) => toPlayerDto(item.player));

  return {
    id: row.match.id,
    roundIndex: row.match.roundIndex,
    court: row.match.court,
    courtName: courtLabel(row.match.court, row.tournament.courtNames),
    status: row.match.status,
    teamA: { players: teamA, score: row.match.scoreA },
    teamB: { players: teamB, score: row.match.scoreB },
    startedAt: row.match.startedAt?.toISOString() ?? null,
    pausedAt: row.match.pausedAt?.toISOString() ?? null,
    pausedTotalMs: row.match.pausedTotalMs,
    finishedAt: row.match.finishedAt?.toISOString() ?? null,
    durationMs:
      row.tournament.matchDurationMin === null ? null : row.tournament.matchDurationMin * 60_000,
    version: row.match.version,
  };
}

async function loadMatchContext(
  db: Database,
  matchId: string,
): Promise<{ match: MatchRow; tournament: TournamentRow }> {
  const [row] = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw notFound('Матч не найден');
  return { match: row.match, tournament: row.tournament };
}

/**
 * Оптимистичная блокировка.
 *
 * Два модератора могут одновременно вводить счёт с разных телефонов. Клиент
 * присылает версию, которую видел; если она устарела, действие отклоняется, а
 * фронт показывает актуальные данные и предлагает решить, что записать.
 */
function ensureVersion(match: MatchRow, expected: number | undefined): void {
  if (expected === undefined) return;
  if (match.version !== expected) {
    throw conflictVersion({ currentVersion: match.version });
  }
}

interface MutateOptions {
  version?: number;
  actor: Viewer;
}

async function applyMatchPatch(
  db: Database,
  matchId: string,
  patch: Partial<typeof matches.$inferInsert>,
  currentVersion: number,
): Promise<void> {
  const result = await db
    .update(matches)
    .set({ ...patch, version: currentVersion + 1, updatedAt: new Date() })
    .where(and(eq(matches.id, matchId), eq(matches.version, currentVersion)))
    .returning({ id: matches.id });

  // Кто-то успел изменить матч между чтением и записью.
  if (result.length === 0) {
    throw conflictVersion();
  }
}

function assertEditable(tournament: TournamentRow, actor: Viewer): void {
  if (!canManageTournaments(actor)) throw forbidden('Вести матч может организатор');
  if (tournament.status === 'finished') {
    throw wrongStatus('Турнир завершён, изменения недоступны');
  }
  if (tournament.status !== 'running') {
    throw wrongStatus('Турнир ещё не начался');
  }
}

const ALLOWED_START: MatchStatus[] = ['scheduled', 'paused'];

export async function startMatch(
  db: Database,
  matchId: string,
  options: MutateOptions,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, options.actor);
  ensureVersion(match, options.version);

  if (!ALLOWED_START.includes(match.status)) {
    throw new ApiError('match_wrong_status', 'Матч уже начат или завершён');
  }

  const now = new Date();
  if (match.status === 'paused') {
    // Пауза не должна съедать игровое время, поэтому копим её отдельно.
    const pausedMs = match.pausedAt ? now.getTime() - match.pausedAt.getTime() : 0;
    await applyMatchPatch(
      db,
      matchId,
      {
        status: 'running',
        pausedAt: null,
        pausedTotalMs: match.pausedTotalMs + Math.max(0, pausedMs),
      },
      match.version,
    );
  } else {
    await applyMatchPatch(db, matchId, { status: 'running', startedAt: now }, match.version);
  }

  await recordAudit(db, options.actor, {
    action: match.status === 'paused' ? 'match.resumed' : 'match.started',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

export async function pauseMatch(
  db: Database,
  matchId: string,
  options: MutateOptions,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, options.actor);
  ensureVersion(match, options.version);

  if (match.status !== 'running') {
    throw new ApiError('match_wrong_status', 'Поставить на паузу можно только идущий матч');
  }

  await applyMatchPatch(db, matchId, { status: 'paused', pausedAt: new Date() }, match.version);
  await recordAudit(db, options.actor, {
    action: 'match.paused',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

/**
 * Завершение матча — всегда ручное действие.
 *
 * Даже когда таймер вышел, розыгрыш может продолжаться, поэтому сервер сам
 * матчи не закрывает: организатор нажимает кнопку, когда игра действительно
 * закончилась.
 */
export async function finishMatch(
  db: Database,
  matchId: string,
  options: MutateOptions,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, options.actor);
  ensureVersion(match, options.version);

  if (match.status === 'finished') {
    return loadMatchDto(db, matchId);
  }

  const now = new Date();
  const pausedMs =
    match.status === 'paused' && match.pausedAt ? now.getTime() - match.pausedAt.getTime() : 0;

  await applyMatchPatch(
    db,
    matchId,
    {
      status: 'finished',
      finishedAt: now,
      startedAt: match.startedAt ?? now,
      pausedAt: null,
      pausedTotalMs: match.pausedTotalMs + Math.max(0, pausedMs),
    },
    match.version,
  );

  await recordAudit(db, options.actor, {
    action: 'match.finished',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

/** Возвращает завершённый матч в игру, если кнопку нажали по ошибке. */
export async function reopenMatch(
  db: Database,
  matchId: string,
  options: MutateOptions,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, options.actor);
  ensureVersion(match, options.version);

  if (match.status !== 'finished') {
    throw new ApiError('match_wrong_status', 'Матч не завершён');
  }

  await applyMatchPatch(db, matchId, { status: 'running', finishedAt: null }, match.version);
  await recordAudit(db, options.actor, {
    action: 'match.reopened',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

export async function setMatchScore(
  db: Database,
  matchId: string,
  input: { scoreA: number; scoreB: number; version: number },
  actor: Viewer,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, actor);
  ensureVersion(match, input.version);

  if (tournament.tieRule === 'golden_point' && input.scoreA === input.scoreB) {
    throw new ApiError('validation_failed', 'В этом турнире ничья не допускается');
  }

  const now = new Date();
  await applyMatchPatch(
    db,
    matchId,
    {
      scoreA: input.scoreA,
      scoreB: input.scoreB,
      // Введённый счёт означает, что игра закончилась.
      status: 'finished',
      finishedAt: match.finishedAt ?? now,
      startedAt: match.startedAt ?? now,
      pausedAt: null,
    },
    match.version,
  );

  await recordAudit(db, actor, {
    action: match.scoreA === null ? 'match.score_set' : 'match.score_edited',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
    payload: {
      from: { scoreA: match.scoreA, scoreB: match.scoreB },
      to: { scoreA: input.scoreA, scoreB: input.scoreB },
    },
  });

  return loadMatchDto(db, matchId);
}

/** Сбрасывает счёт, чтобы можно было ввести его заново. */
export async function clearMatchScore(
  db: Database,
  matchId: string,
  options: MutateOptions,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, options.actor);
  ensureVersion(match, options.version);

  await applyMatchPatch(db, matchId, { scoreA: null, scoreB: null }, match.version);
  await recordAudit(db, options.actor, {
    action: 'match.score_cleared',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

export async function getMatchTournamentId(db: Database, matchId: string): Promise<string> {
  const [row] = await db
    .select({ tournamentId: matches.tournamentId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw notFound('Матч не найден');
  return row.tournamentId;
}
