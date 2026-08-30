import { and, asc, count, eq, ne, notInArray } from 'drizzle-orm';
import {
  ScheduleError,
  buildFixedPairsGroupSchedule,
  generateAmericanoSchedule,
  generateMexicanoRound,
  combinedPairRating,
  makePair,
  matchesPerRound,
  nextAmericanoRound,
  type EnginePlayer,
  type EnginePair,
  type MatchPlan,
  type RoundPlan,
  type SchedulePlan,
  type Team,
} from '@fsp/engine';
import {
  isFixedPairsFormat,
  parseBracketConfig,
  validateBracketConfig,
  type StandingsSortKey,
} from '@fsp/shared';
import { isTournamentClosed } from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  matchPlayers,
  matches,
  players,
  roundSitouts,
  rounds,
  tournamentPlayers,
  tournaments,
  type TournamentRow,
} from '../db/schema.js';
import { ApiError, forbidden, wrongStatus } from '../lib/errors.js';
import { canManageTournaments, type Viewer } from '../auth/context.js';
import { getTournamentRow } from './tournaments.js';
import { loadRegisteredPairs } from './partners.js';
import { computeTournamentStandings, loadCourtHistory } from './state.js';
import { recordAudit } from './audit.js';

/** Сколько раундов создавать, если организатор выбрал «до остановки». */
const OPEN_ENDED_ROUND_LIMIT = 30;

function toScheduleError(error: unknown): never {
  if (error instanceof ScheduleError) {
    throw new ApiError(error.code, error.message);
  }
  throw error;
}

async function loadRoster(db: Database, tournamentId: string): Promise<EnginePlayer[]> {
  const rows = await db
    .select({ id: players.id, rating: players.doublesRating })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.status, 'registered'),
      ),
    )
    .orderBy(asc(tournamentPlayers.createdAt));

  return rows.map((row) => ({ id: row.id, rating: row.rating }));
}

async function hasStartedMatches(db: Database, tournamentId: string): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), ne(matches.status, 'scheduled')));
  return Number(row?.total ?? 0) > 0;
}

async function persistMatchLineup(
  db: Database,
  tournamentId: string,
  roundId: string,
  roundIndex: number,
  match: MatchPlan,
): Promise<void> {
  const [created] = await db
    .insert(matches)
    .values({
      tournamentId,
      roundId,
      roundIndex,
      court: match.court,
      stage: match.stage ?? null,
      groupIndex: match.groupIndex ?? null,
      bracketSlot: match.bracketSlot ?? null,
    })
    .returning();
  if (!created) throw new ApiError('internal', 'Не удалось создать матч');

  const lineup = [
    { team: 'A' as const, ids: match.teamA },
    { team: 'B' as const, ids: match.teamB },
  ].flatMap(({ team, ids }) =>
    ids.map((playerId, slot) => ({ matchId: created.id, playerId, team, slot })),
  );
  await db.insert(matchPlayers).values(lineup);
}

export async function persistRound(db: Database, tournamentId: string, plan: RoundPlan): Promise<void> {
  const [round] = await db.insert(rounds).values({ tournamentId, index: plan.index }).returning();
  if (!round) throw new ApiError('internal', 'Не удалось создать раунд');

  for (const match of plan.matches) {
    await persistMatchLineup(db, tournamentId, round.id, plan.index, match);
  }

  if (plan.sittingOut.length > 0) {
    await db
      .insert(roundSitouts)
      .values(plan.sittingOut.map((playerId) => ({ roundId: round.id, playerId })));
  }
}

export async function persistMatchInRound(
  db: Database,
  tournamentId: string,
  roundIndex: number,
  match: MatchPlan,
): Promise<void> {
  const [row] = await db
    .select({ roundId: matches.roundId })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.roundIndex, roundIndex)))
    .limit(1);
  if (!row) throw new ApiError('internal', 'Раунд для матча не найден');
  await persistMatchLineup(db, tournamentId, row.roundId, roundIndex, match);
}

async function persistSchedule(
  db: Database,
  tournamentId: string,
  plan: SchedulePlan,
): Promise<void> {
  await db.delete(rounds).where(eq(rounds.tournamentId, tournamentId));
  for (const round of plan) {
    await persistRound(db, tournamentId, round);
  }
}

function plannedRoundCount(tournament: TournamentRow, playerCount: number): number {
  if (tournament.roundsPlanned !== null) return tournament.roundsPlanned;
  // «До остановки»: собираем полный круг, дальше раунды добавляются по одному.
  return Math.min(Math.max(playerCount - 1, 1), OPEN_ENDED_ROUND_LIMIT);
}

function buildAmericano(
  tournament: TournamentRow,
  roster: readonly EnginePlayer[],
  seed: number,
): SchedulePlan {
  try {
    return generateAmericanoSchedule({
      players: roster,
      courts: tournament.courts,
      rounds: plannedRoundCount(tournament, roster.length),
      ratingBalance: tournament.ratingBalance,
      seed,
    });
  } catch (error) {
    toScheduleError(error);
  }
}

function buildMexicanoFirstRound(
  tournament: TournamentRow,
  roster: readonly EnginePlayer[],
  seed: number,
): RoundPlan {
  try {
    return generateMexicanoRound({
      players: roster,
      courts: tournament.courts,
      roundIndex: 0,
      ratingBalance: tournament.ratingBalance,
      seed,
    });
  } catch (error) {
    toScheduleError(error);
  }
}

/**
 * Переводит турнир в состояние «идёт» и создаёт игры.
 *
 * Americano получает всё расписание сразу: организатору важно видеть заранее,
 * кто с кем играет, и иметь возможность перемешать пары до первого матча.
 * Mexicano так не умеет: каждый следующий раунд зависит от таблицы, поэтому
 * создаётся только первый раунд.
 */
export async function startTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
  options: { seed?: number } = {},
): Promise<void> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status === 'running') throw wrongStatus('Турнир уже идёт');
  if (isTournamentClosed(tournament.status)) throw wrongStatus('Турнир уже завершён');

  const [pending] = await db
    .select({ total: count() })
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.status, 'registered'),
        eq(tournamentPlayers.confirmedAndPaid, false),
      ),
    );
  if (Number(pending?.total ?? 0) > 0) {
    throw new ApiError('not_all_confirmed', 'Сначала подтвердите всех участников');
  }

  const roster = await loadRoster(db, tournamentId);
  const seed = options.seed ?? Math.floor(Math.random() * 1_000_000) + 1;

  if (isFixedPairsFormat(tournament.format)) {
    const { pairs, orphans } = await loadRegisteredPairs(db, tournamentId);
    if (orphans.length > 0 || pairs.length < 2) {
      throw new ApiError(
        'not_enough_players',
        'Соберите все пары: в составе не должно остаться игроков без партнёра',
      );
    }
    const config = parseBracketConfig(tournament.format, tournament.bracketConfig, tournament.pointsToWin);
    if (!config) {
      throw new ApiError('validation_failed', 'Не задана сетка турнира');
    }
    if (validateBracketConfig(config).length > 0) {
      throw new ApiError(
        'schedule_impossible',
        'Сетка неполная: нужен финал и матч за 3-е место, все пары в матчах должны быть выбраны',
      );
    }
    const enginePairs: EnginePair[] = pairs.map(({ a, b }) =>
      makePair(
        a.player.id,
        b.player.id,
        combinedPairRating(a.player.doublesRating, b.player.doublesRating),
      ),
    );
    try {
      const plan = buildFixedPairsGroupSchedule({
        pairs: enginePairs,
        courts: tournament.courts,
        groupCount: config.groupCount,
        groupMatchesPerPairing: config.groupMatchesPerPairing,
        pairGroups: config.pairGroups,
      });
      await persistSchedule(db, tournamentId, plan);
    } catch (error) {
      toScheduleError(error);
    }
  } else {
    if (roster.length < 4) {
      throw new ApiError('not_enough_players', 'Для парной игры нужно минимум четыре игрока');
    }
    if (matchesPerRound(roster.length, tournament.courts) < 1) {
      throw new ApiError('not_enough_players', 'Игроков не хватает даже на один корт');
    }

    if (tournament.format === 'americano') {
      const plan = buildAmericano(tournament, roster, seed);
      await persistSchedule(db, tournamentId, plan);
    } else {
      const plan = buildMexicanoFirstRound(tournament, roster, seed);
      await db.delete(rounds).where(eq(rounds.tournamentId, tournamentId));
      await persistRound(db, tournamentId, plan);
    }
  }

  await db
    .update(tournaments)
    .set({ status: 'running', scheduleSeed: seed, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.started',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
    payload: { seed, players: roster.length, format: tournament.format },
  });
}

/**
 * Пересобирает пары. Разрешено только пока не начался ни один матч —
 * иначе уже сыгранные результаты потеряли бы смысл.
 */
export async function reshuffleSchedule(
  db: Database,
  tournamentId: string,
  actor: Viewer,
  options: { seed?: number } = {},
): Promise<void> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status !== 'running') {
    throw wrongStatus('Перемешать пары можно только в идущем турнире');
  }
  if (await hasStartedMatches(db, tournamentId)) {
    throw wrongStatus('Перемешать можно только до начала первого матча');
  }
  if (isFixedPairsFormat(tournament.format)) {
    throw wrongStatus('В формате фиксированных пар пары не перемешиваются');
  }

  const roster = await loadRoster(db, tournamentId);
  const seed = options.seed ?? tournament.scheduleSeed + 1;

  if (tournament.format === 'americano') {
    await persistSchedule(db, tournamentId, buildAmericano(tournament, roster, seed));
  } else {
    await db.delete(rounds).where(eq(rounds.tournamentId, tournamentId));
    await persistRound(db, tournamentId, buildMexicanoFirstRound(tournament, roster, seed));
  }

  await db
    .update(tournaments)
    .set({ scheduleSeed: seed, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.reshuffled',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
    payload: { seed },
  });
}

/**
 * Добавляет следующий раунд.
 *
 * Для mexicano это основной способ движения турнира: состав корта зависит от
 * текущей таблицы. Для americano нужен, когда игр не ограничивали числом.
 */
export async function appendRound(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<number> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status !== 'running') throw wrongStatus('Турнир не идёт');
  if (isFixedPairsFormat(tournament.format)) {
    throw wrongStatus('Следующий раунд в этом формате появляется из сетки, а не вручную');
  }

  const roundRows = await db
    .select()
    .from(rounds)
    .where(eq(rounds.tournamentId, tournamentId))
    .orderBy(asc(rounds.index));
  const lastRound = roundRows.at(-1);
  const nextIndex = lastRound ? lastRound.index + 1 : 0;

  if (tournament.roundsPlanned !== null && nextIndex >= tournament.roundsPlanned) {
    throw wrongStatus('Все запланированные игры уже созданы');
  }

  if (lastRound) {
    // Mexicano: нужен именно finished со счётом — следующий раунд от таблицы.
    // Americano: достаточно закрытого раунда (finished или skipped).
    const openFilter =
      tournament.format === 'mexicano'
        ? and(eq(matches.roundId, lastRound.id), ne(matches.status, 'finished'))
        : and(
            eq(matches.roundId, lastRound.id),
            notInArray(matches.status, ['finished', 'skipped']),
          );
    const [unfinished] = await db.select({ total: count() }).from(matches).where(openFilter);
    if (Number(unfinished?.total ?? 0) > 0) {
      throw new ApiError('round_not_finished', 'Сначала завершите все матчи текущего раунда');
    }
  }

  const roster = await loadRoster(db, tournamentId);
  const previousSitouts = lastRound
    ? (
        await db
          .select({ playerId: roundSitouts.playerId })
          .from(roundSitouts)
          .where(eq(roundSitouts.roundId, lastRound.id))
      ).map((row) => row.playerId)
    : [];

  let plan: RoundPlan;

  if (tournament.format === 'mexicano') {
    const standings = await computeTournamentStandings(
      db,
      tournament,
      tournament.standingsSort as StandingsSortKey[],
    );
    const gamesPlayed: Record<string, number> = {};
    for (const row of standings) {
      gamesPlayed[row.player.id] = row.played;
    }
    try {
      plan = generateMexicanoRound({
        players: roster,
        courts: tournament.courts,
        roundIndex: nextIndex,
        standings: standings.map((row) => ({
          playerId: row.player.id,
          played: row.played,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
          pointsFor: row.pointsFor,
          pointsAgainst: row.pointsAgainst,
          diff: row.diff,
        })),
        gamesPlayed,
        satLastRound: previousSitouts,
        ratingBalance: tournament.ratingBalance,
        seed: tournament.scheduleSeed,
      });
    } catch (error) {
      toScheduleError(error);
    }
  } else {
    // Берём все созданные матчи, а не только со счётом: пара уже сыграла вместе
    // и корт уже был занят, даже если счёт не внесли.
    const history = await loadCourtHistory(db, tournamentId);
    const playedMatches = history.map((match) => ({
      court: match.court,
      teamA: [match.teamA[0] as string, match.teamA[1] as string] as Team,
      teamB: [match.teamB[0] as string, match.teamB[1] as string] as Team,
    }));
    try {
      plan = nextAmericanoRound({
        players: roster,
        courts: tournament.courts,
        roundIndex: nextIndex,
        playedMatches,
        satLastRound: previousSitouts,
        ratingBalance: tournament.ratingBalance,
        seed: tournament.scheduleSeed,
      });
    } catch (error) {
      toScheduleError(error);
    }
  }

  await persistRound(db, tournamentId, plan);
  await recordAudit(db, actor, {
    action: 'round.created',
    entityType: 'round',
    entityId: String(nextIndex),
    tournamentId,
    payload: { index: nextIndex },
  });

  return nextIndex;
}
