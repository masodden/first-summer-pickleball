import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { computeStandings, resolveMedals, type MatchResult } from '@fsp/engine';
import { courtLabel, isMatchClosed } from '@fsp/shared';
import type {
  MatchDto,
  PlayerDto,
  RoundDto,
  StandingRowDto,
  StandingsSortKey,
  TournamentStateDto,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  matchPlayers,
  matches,
  players,
  roundSitouts,
  rounds,
  tournamentPlayers,
  type MatchRow,
  type PlayerRow,
  type TournamentRow,
} from '../db/schema.js';
import { toPlayerDto } from './mappers.js';
import { getTournamentDto, getTournamentRow, listParticipants } from './tournaments.js';
import type { Viewer } from '../auth/context.js';

function toMatchDto(
  row: MatchRow,
  teamA: PlayerDto[],
  teamB: PlayerDto[],
  durationMs: number | null,
  courtNames: string[] | null,
): MatchDto {
  return {
    id: row.id,
    roundIndex: row.roundIndex,
    court: row.court,
    courtName: courtLabel(row.court, courtNames),
    status: row.status,
    teamA: { players: teamA, score: row.scoreA },
    teamB: { players: teamB, score: row.scoreB },
    startedAt: row.startedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    pausedTotalMs: row.pausedTotalMs,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs,
    version: row.version,
  };
}

export async function loadRounds(db: Database, tournament: TournamentRow): Promise<RoundDto[]> {
  const roundRows = await db
    .select()
    .from(rounds)
    .where(eq(rounds.tournamentId, tournament.id))
    .orderBy(asc(rounds.index));
  if (roundRows.length === 0) return [];

  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournament.id))
    .orderBy(asc(matches.roundIndex), asc(matches.court));

  const lineupRows = await db
    .select({ lineup: matchPlayers, player: players, matchRoundId: matches.roundId })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(players, eq(players.id, matchPlayers.playerId))
    .where(eq(matches.tournamentId, tournament.id))
    .orderBy(asc(matchPlayers.slot));

  const sitoutRows = await db
    .select({ sitout: roundSitouts, player: players })
    .from(roundSitouts)
    .innerJoin(rounds, eq(rounds.id, roundSitouts.roundId))
    .innerJoin(players, eq(players.id, roundSitouts.playerId))
    .where(eq(rounds.tournamentId, tournament.id));

  const lineupByMatch = new Map<string, { A: PlayerDto[]; B: PlayerDto[] }>();
  for (const row of lineupRows) {
    const bucket = lineupByMatch.get(row.lineup.matchId) ?? { A: [], B: [] };
    bucket[row.lineup.team].push(toPlayerDto(row.player));
    lineupByMatch.set(row.lineup.matchId, bucket);
  }

  const sitoutsByRound = new Map<string, PlayerDto[]>();
  for (const row of sitoutRows) {
    const bucket = sitoutsByRound.get(row.sitout.roundId) ?? [];
    bucket.push(toPlayerDto(row.player));
    sitoutsByRound.set(row.sitout.roundId, bucket);
  }

  const durationMs =
    tournament.matchDurationMin === null ? null : tournament.matchDurationMin * 60_000;

  return roundRows.map((round) => {
    const roundMatches = matchRows
      .filter((match) => match.roundId === round.id)
      .map((match) => {
        const lineup = lineupByMatch.get(match.id) ?? { A: [], B: [] };
        return toMatchDto(match, lineup.A, lineup.B, durationMs, tournament.courtNames);
      });

    const skipped =
      roundMatches.length > 0 && roundMatches.every((match) => match.status === 'skipped');
    const closed =
      roundMatches.length > 0 && roundMatches.every((match) => isMatchClosed(match.status));

    return {
      index: round.index,
      matches: roundMatches,
      sittingOut: sitoutsByRound.get(round.id) ?? [],
      allFinished:
        roundMatches.length > 0 && roundMatches.every((match) => match.status === 'finished'),
      allScored:
        roundMatches.length > 0 &&
        roundMatches.every(
          (match) =>
            match.status === 'skipped' ||
            (match.teamA.score !== null && match.teamB.score !== null),
        ),
      skipped,
      closed,
    };
  });
}

/** Результаты для таблицы: считаем только матчи с введённым счётом. */
export async function loadMatchResults(db: Database, tournamentId: string): Promise<MatchResult[]> {
  const rows = await db
    .select({ match: matches, lineup: matchPlayers })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(and(eq(matches.tournamentId, tournamentId), isNotNull(matches.scoreA)));

  const grouped = new Map<string, { match: MatchRow; teamA: string[]; teamB: string[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.match.id) ?? { match: row.match, teamA: [], teamB: [] };
    if (row.lineup.team === 'A') entry.teamA.push(row.lineup.playerId);
    else entry.teamB.push(row.lineup.playerId);
    grouped.set(row.match.id, entry);
  }

  const results: MatchResult[] = [];
  for (const entry of grouped.values()) {
    if (entry.match.scoreA === null || entry.match.scoreB === null) continue;
    results.push({
      teamA: entry.teamA,
      teamB: entry.teamB,
      scoreA: entry.match.scoreA,
      scoreB: entry.match.scoreB,
    });
  }
  return results;
}

/**
 * Кто на каких кортах уже играл. Счёт неважен: корт был занят и в незавершённом
 * матче, а движку это нужно, чтобы следующий раунд поставить ровнее.
 */
export async function loadCourtHistory(
  db: Database,
  tournamentId: string,
): Promise<{ court: number; teamA: string[]; teamB: string[] }[]> {
  const rows = await db
    .select({ match: matches, lineup: matchPlayers })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(eq(matches.tournamentId, tournamentId));

  const grouped = new Map<string, { court: number; teamA: string[]; teamB: string[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.match.id) ?? { court: row.match.court, teamA: [], teamB: [] };
    if (row.lineup.team === 'A') entry.teamA.push(row.lineup.playerId);
    else entry.teamB.push(row.lineup.playerId);
    grouped.set(row.match.id, entry);
  }

  return [...grouped.values()];
}

export async function computeTournamentStandings(
  db: Database,
  tournament: TournamentRow,
  sortKeys?: readonly StandingsSortKey[],
): Promise<StandingRowDto[]> {
  const participantRows = await db
    .select({ participant: tournamentPlayers, player: players })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournament.id),
        eq(tournamentPlayers.status, 'registered'),
      ),
    );

  const playerById = new Map<string, PlayerRow>(
    participantRows.map((row) => [row.player.id, row.player]),
  );
  const results = await loadMatchResults(db, tournament.id);

  const keys = sortKeys ?? (tournament.standingsSort as StandingsSortKey[]);
  const rows = computeStandings([...playerById.keys()], results, keys);
  const medals =
    tournament.status === 'finished' || tournament.status === 'archived'
      ? resolveMedals(rows)
      : rows.map(() => null);

  return rows.map((row, index) => {
    const player = playerById.get(row.playerId);
    return {
      rank: index + 1,
      player: player
        ? toPlayerDto(player)
        : {
            id: row.playerId,
            duprId: null,
            firstName: 'Игрок',
            lastName: '',
            fullName: 'Игрок',
            doublesRating: null,
            singlesRating: null,
            ratingUpdatedAt: null,
            ratingSource: null,
            ratingStale: false,
            pendingImportRating: null,
            avatarUrl: null,
            telegramUsername: null,
            clubRole: 'user',
            isGuest: true,
            isClaimed: false,
            createdAt: new Date(0).toISOString(),
          },
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      diff: row.diff,
      medal: medals[index] ?? null,
    };
  });
}

export async function getTournamentState(
  db: Database,
  tournamentId: string,
  viewer: Viewer | null,
): Promise<TournamentStateDto> {
  const row = await getTournamentRow(db, tournamentId);
  const [tournament, participants, roundDtos, standings] = await Promise.all([
    getTournamentDto(db, tournamentId, viewer),
    listParticipants(db, tournamentId),
    loadRounds(db, row),
    computeTournamentStandings(db, row),
  ]);

  return {
    tournament,
    participants: participants.participants,
    rounds: roundDtos,
    standings,
  };
}
