import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import {
  computeStandings,
  computeTeamStandings,
  makePair,
  pairIdFromPlayers,
  resolveMedals,
  type MatchResult,
  type EnginePair,
} from '@fsp/engine';
import {
  courtLabel,
  isFixedPairsFormat,
  isMatchClosed,
  parseBracketConfig,
} from '@fsp/shared';
import type {
  MatchDto,
  PlayerDto,
  RoundDto,
  StandingRowDto,
  StandingsSortKey,
  TeamStandingRowDto,
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
import { matchDtoExtras } from './match-dto.js';
import { loadRegisteredPairs } from './partners.js';
import type { Viewer } from '../auth/context.js';

function toMatchDto(
  row: MatchRow,
  teamA: PlayerDto[],
  teamB: PlayerDto[],
  durationMs: number | null,
  tournament: TournamentRow,
): MatchDto {
  return {
    id: row.id,
    roundIndex: row.roundIndex,
    court: row.court,
    courtName: courtLabel(row.court, tournament.courtNames),
    status: row.status,
    teamA: { players: teamA, score: row.scoreA },
    teamB: { players: teamB, score: row.scoreB },
    startedAt: row.startedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    pausedTotalMs: row.pausedTotalMs,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs,
    version: row.version,
    ...matchDtoExtras(row, tournament),
  };
}

/** Один раунд — для `round.updated`, чтобы второй телефон видел тот же closed/allScored. */
export async function loadRound(
  db: Database,
  tournament: TournamentRow,
  roundIndex: number,
): Promise<RoundDto | null> {
  const rounds = await loadRounds(db, tournament);
  return rounds.find((round) => round.index === roundIndex) ?? null;
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
        return toMatchDto(match, lineup.A, lineup.B, durationMs, tournament);
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

/** Результаты для таблицы: только сыгранные матчи, пропущенные не считаем. */
export async function loadMatchResults(db: Database, tournamentId: string): Promise<MatchResult[]> {
  const rows = await db
    .select({ match: matches, lineup: matchPlayers })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        isNotNull(matches.scoreA),
        ne(matches.status, 'skipped'),
      ),
    );

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
  let medals =
    tournament.status === 'finished' || tournament.status === 'archived'
      ? resolveMedals(rows)
      : rows.map(() => null);

  if (isFixedPairsFormat(tournament.format) && (tournament.status === 'finished' || tournament.status === 'archived')) {
    const teams = await computeTournamentTeamStandings(db, tournament);
    const byPlayer = new Map<string, 'gold' | 'silver' | 'bronze'>();
    for (const row of teams) {
      if (!row.medal) continue;
      byPlayer.set(row.players[0].id, row.medal);
      byPlayer.set(row.players[1].id, row.medal);
    }
    medals = rows.map((row) => byPlayer.get(row.playerId) ?? null);
  }

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

export async function computeTournamentTeamStandings(
  db: Database,
  tournament: TournamentRow,
): Promise<TeamStandingRowDto[]> {
  if (!isFixedPairsFormat(tournament.format)) return [];
  const config = parseBracketConfig(tournament.format, tournament.bracketConfig, tournament.pointsToWin);
  if (!config) return [];

  const { pairs } = await loadRegisteredPairs(db, tournament.id);
  const catalog = new Map<string, EnginePair>();
  const playerById = new Map<string, PlayerDto>();
  for (const { a, b } of pairs) {
    const pair = makePair(a.player.id, b.player.id);
    catalog.set(pair.id, pair);
    playerById.set(a.player.id, a.player);
    playerById.set(b.player.id, b.player);
  }

  const rows = await db
    .select({ match: matches, lineup: matchPlayers })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(eq(matches.tournamentId, tournament.id));

  const grouped = new Map<string, { match: MatchRow; teamA: string[]; teamB: string[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.match.id) ?? { match: row.match, teamA: [], teamB: [] };
    if (row.lineup.team === 'A') entry.teamA.push(row.lineup.playerId);
    else entry.teamB.push(row.lineup.playerId);
    grouped.set(row.match.id, entry);
  }

  const medals = new Map<string, 'gold' | 'silver' | 'bronze'>();
  if (tournament.status === 'finished' || tournament.status === 'archived') {
    for (const entry of grouped.values()) {
      const slot = entry.match.bracketSlot;
      if (!slot || entry.match.stage === 'group') continue;
      if (entry.match.scoreA === null || entry.match.scoreB === null) continue;
      const a = pairIdFromPlayers(entry.teamA);
      const b = pairIdFromPlayers(entry.teamB);
      if (!a || !b) continue;
      const winner = entry.match.scoreA > entry.match.scoreB ? a : b;
      const loser = winner === a ? b : a;
      if (slot === 'final') {
        medals.set(winner, 'gold');
        medals.set(loser, 'silver');
      }
      if (slot === 'bronze') medals.set(winner, 'bronze');
    }
  }

  const result: TeamStandingRowDto[] = [];
  for (let groupIndex = 0; groupIndex < config.groupCount; groupIndex += 1) {
    const fromMatches = [...catalog.values()].filter((pair) => {
      const assigned = config.pairGroups?.[pair.id];
      if (assigned !== undefined) return assigned === groupIndex;
      return [...grouped.values()].some(
        (item) =>
          item.match.stage === 'group' &&
          item.match.groupIndex === groupIndex &&
          (pairIdFromPlayers(item.teamA) === pair.id || pairIdFromPlayers(item.teamB) === pair.id),
      );
    });
    const groupPairs =
      fromMatches.length > 0
        ? fromMatches
        : groupIndex === 0
          ? [...catalog.values()]
          : [];
    const teamResults = [...grouped.values()]
      .filter((item) => item.match.stage === 'group' && item.match.groupIndex === groupIndex)
      .flatMap((item) => {
        const teamA = catalog.get(pairIdFromPlayers(item.teamA) ?? '');
        const teamB = catalog.get(pairIdFromPlayers(item.teamB) ?? '');
        if (!teamA || !teamB || item.match.scoreA === null || item.match.scoreB === null) return [];
        if (item.match.status === 'skipped') return [];
        const games = item.match.games ?? [];
        const pointsA =
          games.length > 0 ? games.reduce((sum, game) => sum + game.scoreA, 0) : item.match.scoreA;
        const pointsB =
          games.length > 0 ? games.reduce((sum, game) => sum + game.scoreB, 0) : item.match.scoreB;
        return [
          {
            teamA,
            teamB,
            scoreA: item.match.scoreA,
            scoreB: item.match.scoreB,
            pointsA,
            pointsB,
            groupIndex,
          },
        ];
      });
    const table = computeTeamStandings(groupPairs, teamResults, groupIndex);
    for (const row of table) {
      const left = playerById.get(row.pair.players[0]);
      const right = playerById.get(row.pair.players[1]);
      if (!left || !right) continue;
      const medal = medals.get(row.pair.id) ?? null;
      result.push({
        rank: row.rank,
        players: [left, right],
        groupIndex: row.groupIndex,
        played: row.played,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        diff: row.diff,
        medal,
      });
    }
  }

  if (medals.size === 0 && (tournament.status === 'finished' || tournament.status === 'archived')) {
    const overall = [...result].sort(
      (a, b) => b.wins - a.wins || b.diff - a.diff || b.pointsFor - a.pointsFor,
    );
    const kinds = ['gold', 'silver', 'bronze'] as const;
    overall.slice(0, 3).forEach((row, index) => {
      row.medal = kinds[index] ?? null;
    });
  }

  return result;
}

export async function getTournamentState(
  db: Database,
  tournamentId: string,
  viewer: Viewer | null,
): Promise<TournamentStateDto> {
  const row = await getTournamentRow(db, tournamentId);
  const [tournament, participants, roundDtos, standings, teamStandings] = await Promise.all([
    getTournamentDto(db, tournamentId, viewer),
    listParticipants(db, tournamentId),
    loadRounds(db, row),
    computeTournamentStandings(db, row),
    computeTournamentTeamStandings(db, row),
  ]);

  return {
    tournament,
    participants: participants.participants,
    rounds: roundDtos,
    standings,
    teamStandings,
  };
}
