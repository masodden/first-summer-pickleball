import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  courtLabel,
  gameScoreIssue,
  gameSettingsForMatch,
  isFixedPairsFormat,
  isMatchClosed,
  isTournamentClosed,
  parseBracketConfig,
  type MatchDto,
  type MatchGameDto,
  type MatchStatus,
} from '@fsp/shared';
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
import { syncFixedPairsBracket } from './bracket-sync.js';
import { matchDtoExtras } from './match-dto.js';

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
    ...matchDtoExtras(row.match, row.tournament),
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
  if (isTournamentClosed(tournament.status)) {
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

  if (isFixedPairsFormat(tournament.format)) {
    await assertPlayersFree(db, tournament.id, matchId);
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

function assertValidGame(
  game: MatchGameDto,
  pointsToWin: number,
  winByTwo: boolean,
): void {
  const issue = gameScoreIssue(game.scoreA, game.scoreB, { pointsToWin, winByTwo });
  if (issue === 'tie') {
    throw new ApiError('validation_failed', 'В гейме нужен победитель');
  }
  if (issue === 'winByTwo') {
    throw new ApiError('validation_failed', 'Нужна победа с разницей в два очка');
  }
  if (issue) {
    throw new ApiError('validation_failed', `Гейм играют до ${pointsToWin}`);
  }
}

function resolveScorePayload(
  tournament: TournamentRow,
  match: MatchRow,
  input: { scoreA: number; scoreB: number; games?: MatchGameDto[] },
): { scoreA: number; scoreB: number; games: MatchGameDto[] | null } {
  const config = parseBracketConfig(tournament.format, tournament.bracketConfig, tournament.pointsToWin);
  if (!isFixedPairsFormat(tournament.format) || !config) {
    return { scoreA: input.scoreA, scoreB: input.scoreB, games: null };
  }
  const settings = gameSettingsForMatch(config, {
    stage: match.stage,
    bracketSlot: match.bracketSlot,
  });
  if (settings.winsToTake <= 1) {
    const game = input.games?.[0] ?? { scoreA: input.scoreA, scoreB: input.scoreB };
    assertValidGame(game, settings.pointsToWin, settings.winByTwo);
    return { scoreA: game.scoreA, scoreB: game.scoreB, games: [game] };
  }
  const games = input.games ?? [];
  if (games.length === 0) {
    throw new ApiError('validation_failed', 'Для серии укажите счёт каждого гейма');
  }
  let winsA = 0;
  let winsB = 0;
  for (const game of games) {
    if (winsA === settings.winsToTake || winsB === settings.winsToTake) {
      throw new ApiError('validation_failed', 'Лишние геймы после победы в серии');
    }
    assertValidGame(game, settings.pointsToWin, settings.winByTwo);
    if (game.scoreA > game.scoreB) winsA += 1;
    else winsB += 1;
  }
  if (winsA !== settings.winsToTake && winsB !== settings.winsToTake) {
    throw new ApiError('validation_failed', 'Серия ещё не завершена');
  }
  return { scoreA: winsA, scoreB: winsB, games };
}

export async function setMatchScore(
  db: Database,
  matchId: string,
  input: { scoreA: number; scoreB: number; games?: MatchGameDto[]; version: number },
  actor: Viewer,
): Promise<MatchDto> {
  const { match, tournament } = await loadMatchContext(db, matchId);
  assertEditable(tournament, actor);
  ensureVersion(match, input.version);

  const resolved = resolveScorePayload(tournament, match, input);

  if (tournament.tieRule === 'golden_point' && resolved.scoreA === resolved.scoreB) {
    throw new ApiError('validation_failed', 'В этом турнире ничья не допускается');
  }

  if (match.status === 'skipped') {
    throw wrongStatus('У пропущенного матча нет счёта');
  }

  const now = new Date();
  await applyMatchPatch(
    db,
    matchId,
    {
      scoreA: resolved.scoreA,
      scoreB: resolved.scoreB,
      games: resolved.games,
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
      to: { scoreA: resolved.scoreA, scoreB: resolved.scoreB },
    },
  });

  if (isFixedPairsFormat(tournament.format)) {
    await syncFixedPairsBracket(db, tournament);
  }

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

  await applyMatchPatch(db, matchId, { scoreA: null, scoreB: null, games: null }, match.version);
  await recordAudit(db, options.actor, {
    action: 'match.score_cleared',
    entityType: 'match',
    entityId: matchId,
    tournamentId: tournament.id,
  });

  return loadMatchDto(db, matchId);
}

export type RoundAction = 'start' | 'pause' | 'finish' | 'skip' | 'unskip';

/**
 * Действие сразу по всему раунду.
 *
 * На площадке корты стартуют одновременно: судья свистит один раз, и играют все.
 * Поэтому старт, пауза и завершение — это действия над раундом, а не над
 * отдельным матчем. Счёт остаётся per-match: корты заканчивают вразнобой.
 *
 * Следующий раунд нельзя начать, пока предыдущий не закрыт (finished/skipped).
 * В americano пропущенный раунд можно вернуть (unskip) или сразу запустить.
 * В mexicano пропуска нет: следующий раунд строится по таблице.
 */
export async function applyRoundAction(
  db: Database,
  tournamentId: string,
  roundIndex: number,
  action: RoundAction,
  actor: Viewer,
): Promise<void> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) throw notFound('Турнир не найден');
  assertEditable(tournament, actor);

  const rows = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.roundIndex, roundIndex)))
    .orderBy(asc(matches.court));
  if (rows.length === 0) throw notFound('Раунд не найден');

  if (action === 'skip') {
    if (isFixedPairsFormat(tournament.format)) {
      throw wrongStatus('В формате фиксированных пар раунд не пропускают');
    }
    if (tournament.format === 'mexicano') {
      throw wrongStatus(
        'В mexicano раунд нельзя пропустить: следующий строится по результатам текущего',
      );
    }
    if (!rows.every((match) => match.status === 'scheduled')) {
      throw wrongStatus('Пропустить можно только раунд, который ещё не начинали');
    }
    await assertPreviousRoundClosed(db, tournamentId, roundIndex);
  }

  if (action === 'unskip') {
    if (!rows.every((match) => match.status === 'skipped')) {
      throw wrongStatus('Вернуть можно только пропущенный раунд');
    }
  }

  if (action === 'start') {
    if (!isFixedPairsFormat(tournament.format)) {
      await assertPreviousRoundClosed(db, tournamentId, roundIndex);
      await assertNoOtherLiveRound(db, tournamentId, roundIndex);
    }
  }

  const now = new Date();
  const busyPlayers =
    action === 'start' && isFixedPairsFormat(tournament.format)
      ? await livePlayerIds(db, tournamentId, { exceptRoundIndex: roundIndex })
      : null;
  let started = 0;

  for (const match of rows) {
    const patch = roundPatchFor(match, action, now);
    if (!patch) continue;
    if (busyPlayers) {
      const lineup = await matchPlayerIds(db, match.id);
      if (lineup.some((playerId) => busyPlayers.has(playerId))) continue;
      for (const playerId of lineup) busyPlayers.add(playerId);
      started += 1;
    }
    await applyMatchPatch(db, match.id, patch, match.version);
  }

  if (busyPlayers && started === 0 && rows.some((match) => match.status === 'scheduled')) {
    throw wrongStatus('Свободных пар нет: игроки ещё на других кортах');
  }

  const auditAction =
    action === 'start'
      ? 'round.started'
      : action === 'pause'
        ? 'round.paused'
        : action === 'skip'
          ? 'round.skipped'
          : action === 'unskip'
            ? 'round.unskipped'
            : 'round.finished';

  await recordAudit(db, actor, {
    action: auditAction,
    entityType: 'round',
    entityId: String(roundIndex),
    tournamentId,
    payload: { courts: rows.length },
  });
}

/** Игроки, которые сейчас на корте. */
async function livePlayerIds(
  db: Database,
  tournamentId: string,
  options: { exceptMatchId?: string; exceptRoundIndex?: number } = {},
): Promise<Set<string>> {
  const filters = [
    eq(matches.tournamentId, tournamentId),
    inArray(matches.status, ['running', 'paused']),
  ];
  if (options.exceptMatchId) filters.push(ne(matches.id, options.exceptMatchId));
  if (options.exceptRoundIndex !== undefined) {
    filters.push(ne(matches.roundIndex, options.exceptRoundIndex));
  }
  const live = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(...filters));
  if (live.length === 0) return new Set();
  const lineup = await db
    .select({ playerId: matchPlayers.playerId })
    .from(matchPlayers)
    .where(
      inArray(
        matchPlayers.matchId,
        live.map((row) => row.id),
      ),
    );
  return new Set(lineup.map((row) => row.playerId));
}

async function matchPlayerIds(db: Database, matchId: string): Promise<string[]> {
  const rows = await db
    .select({ playerId: matchPlayers.playerId })
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, matchId));
  return rows.map((row) => row.playerId);
}

async function assertPlayersFree(db: Database, tournamentId: string, matchId: string): Promise<void> {
  const mine = await matchPlayerIds(db, matchId);
  const busy = await livePlayerIds(db, tournamentId, { exceptMatchId: matchId });
  if (mine.some((playerId) => busy.has(playerId))) {
    throw wrongStatus('Эти игроки ещё играют на другом корте');
  }
}

/** Предыдущий раунд должен быть закрыт, иначе на площадке пересекаются игры. */
async function assertPreviousRoundClosed(
  db: Database,
  tournamentId: string,
  roundIndex: number,
): Promise<void> {
  if (roundIndex <= 0) return;

  const previous = await db
    .select({ status: matches.status })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.roundIndex, roundIndex - 1)));

  if (previous.length === 0) return;
  if (!previous.every((row) => isMatchClosed(row.status))) {
    throw wrongStatus('Сначала завершите или пропустите предыдущий раунд');
  }
}

/** На кортах одновременно идёт только один раунд. */
async function assertNoOtherLiveRound(
  db: Database,
  tournamentId: string,
  roundIndex: number,
): Promise<void> {
  const live = await db
    .select({ id: matches.id, roundIndex: matches.roundIndex })
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        inArray(matches.status, ['running', 'paused']),
      ),
    )
    .limit(1);
  const other = live.find((row) => row.roundIndex !== roundIndex);
  if (other) {
    throw wrongStatus('Сначала завершите текущий раунд на кортах');
  }
}

/** Что меняется у отдельного матча при действии над раундом. `null` — уже в нужном состоянии. */
function roundPatchFor(
  match: MatchRow,
  action: RoundAction,
  now: Date,
): Partial<typeof matches.$inferInsert> | null {
  const pausedSinceMs =
    match.status === 'paused' && match.pausedAt ? now.getTime() - match.pausedAt.getTime() : 0;

  if (action === 'skip') {
    if (match.status === 'skipped') return null;
    return {
      status: 'skipped',
      finishedAt: now,
      startedAt: null,
      pausedAt: null,
    };
  }

  if (action === 'unskip') {
    if (match.status !== 'skipped') return null;
    return {
      status: 'scheduled',
      finishedAt: null,
      startedAt: null,
      pausedAt: null,
      pausedTotalMs: 0,
    };
  }

  if (action === 'start') {
    if (match.status === 'running') return null;
    // Finished с счётом не трогаем; skipped можно вернуть в игру.
    if (match.status === 'finished') return null;
    if (match.status === 'paused') {
      return {
        status: 'running',
        pausedAt: null,
        pausedTotalMs: match.pausedTotalMs + Math.max(0, pausedSinceMs),
      };
    }
    if (match.status === 'skipped') {
      return {
        status: 'running',
        startedAt: now,
        finishedAt: null,
        pausedAt: null,
        pausedTotalMs: 0,
      };
    }
    return { status: 'running', startedAt: match.startedAt ?? now };
  }

  if (action === 'pause') {
    if (match.status !== 'running') return null;
    return { status: 'paused', pausedAt: now };
  }

  if (isMatchClosed(match.status)) return null;
  return {
    status: 'finished',
    finishedAt: now,
    startedAt: match.startedAt ?? now,
    pausedAt: null,
    pausedTotalMs: match.pausedTotalMs + Math.max(0, pausedSinceMs),
  };
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
