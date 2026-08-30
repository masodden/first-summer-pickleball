import { and, asc, eq, max } from 'drizzle-orm';
import {
  makePair,
  pairIdFromPlayers,
  resolveSourceToken,
  computeTeamStandings,
  seatPairMatches,
  type EnginePair,
  type OpenPairRound,
  type PairMatch,
  type SourceResult,
} from '@fsp/engine';
import {
  isFixedPairsFormat,
  parseBracketConfig,
  type BracketConfig,
  type BracketStage,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  matchPlayers,
  matches,
  type MatchRow,
  type TournamentRow,
} from '../db/schema.js';
import { persistMatchInRound, persistRound } from './schedule.js';
import { loadRegisteredPairs } from './partners.js';

interface LinedMatch {
  match: MatchRow;
  teamA: string[];
  teamB: string[];
}

function pairFromIds(ids: readonly string[], catalog: ReadonlyMap<string, EnginePair>): EnginePair | null {
  const id = pairIdFromPlayers(ids);
  if (!id) return null;
  return catalog.get(id) ?? makePair(ids[0]!, ids[1]!);
}

function gamesPoints(row: MatchRow): { pointsA: number; pointsB: number } {
  const games = row.games ?? [];
  if (games.length > 0) {
    return {
      pointsA: games.reduce((sum, game) => sum + game.scoreA, 0),
      pointsB: games.reduce((sum, game) => sum + game.scoreB, 0),
    };
  }
  return { pointsA: row.scoreA ?? 0, pointsB: row.scoreB ?? 0 };
}

async function loadLinedMatches(db: Database, tournamentId: string): Promise<LinedMatch[]> {
  const rows = await db
    .select({ match: matches, lineup: matchPlayers })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matchPlayers.slot));

  const grouped = new Map<string, LinedMatch>();
  for (const row of rows) {
    const entry = grouped.get(row.match.id) ?? { match: row.match, teamA: [], teamB: [] };
    if (row.lineup.team === 'A') entry.teamA.push(row.lineup.playerId);
    else entry.teamB.push(row.lineup.playerId);
    grouped.set(row.match.id, entry);
  }
  return [...grouped.values()];
}

function catalogFromPairs(pairs: readonly { a: { player: { id: string } }; b: { player: { id: string } } }[]) {
  const catalog = new Map<string, EnginePair>();
  for (const { a, b } of pairs) {
    const pair = makePair(a.player.id, b.player.id);
    catalog.set(pair.id, pair);
  }
  return catalog;
}

function groupRanks(
  config: BracketConfig,
  catalog: ReadonlyMap<string, EnginePair>,
  lined: readonly LinedMatch[],
): EnginePair[][] {
  const ranks: EnginePair[][] = [];
  for (let groupIndex = 0; groupIndex < config.groupCount; groupIndex += 1) {
    const groupMatches = lined.filter(
      (item) => item.match.stage === 'group' && item.match.groupIndex === groupIndex,
    );
    const complete =
      groupMatches.length > 0 &&
      groupMatches.every(
        (item) =>
          item.match.status === 'skipped' ||
          (item.match.scoreA !== null && item.match.scoreB !== null),
      );
    if (!complete) {
      ranks.push([]);
      continue;
    }

    const pairIds = new Set<string>();
    for (const item of groupMatches) {
      const a = pairIdFromPlayers(item.teamA);
      const b = pairIdFromPlayers(item.teamB);
      if (a) pairIds.add(a);
      if (b) pairIds.add(b);
    }
    const groupPairs = [...catalog.values()].filter((pair) => pairIds.has(pair.id));
    const results = groupMatches
      .filter(
        (item) =>
          item.match.scoreA !== null &&
          item.match.scoreB !== null &&
          item.match.status !== 'skipped',
      )
      .flatMap((item) => {
        const teamA = pairFromIds(item.teamA, catalog);
        const teamB = pairFromIds(item.teamB, catalog);
        if (!teamA || !teamB) return [];
        const points = gamesPoints(item.match);
        return [
          {
            teamA,
            teamB,
            scoreA: item.match.scoreA!,
            scoreB: item.match.scoreB!,
            pointsA: points.pointsA,
            pointsB: points.pointsB,
            groupIndex,
          },
        ];
      });
    const table = computeTeamStandings(groupPairs, results, groupIndex);
    ranks.push(table.map((row) => row.pair));
  }
  return ranks;
}

function slotResults(
  lined: readonly LinedMatch[],
  catalog: ReadonlyMap<string, EnginePair>,
): Record<string, SourceResult> {
  const results: Record<string, SourceResult> = {};
  for (const item of lined) {
    const slot = item.match.bracketSlot;
    if (!slot || item.match.stage === 'group') continue;
    if (item.match.scoreA === null || item.match.scoreB === null) continue;
    if (item.match.status === 'skipped') continue;
    const teamA = pairFromIds(item.teamA, catalog);
    const teamB = pairFromIds(item.teamB, catalog);
    if (!teamA || !teamB) continue;
    const winner = item.match.scoreA > item.match.scoreB ? teamA : teamB;
    const loser = winner.id === teamA.id ? teamB : teamA;
    results[slot] = { winner, loser };
  }
  return results;
}

async function replaceLineup(
  db: Database,
  matchId: string,
  teamA: readonly string[],
  teamB: readonly string[],
): Promise<void> {
  await db.delete(matchPlayers).where(eq(matchPlayers.matchId, matchId));
  const lineup = [
    { team: 'A' as const, ids: teamA },
    { team: 'B' as const, ids: teamB },
  ].flatMap(({ team, ids }) =>
    ids.map((playerId, slot) => ({ matchId, playerId, team, slot })),
  );
  await db.insert(matchPlayers).values(lineup);
}

function sameLineup(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

/**
 * Когда источники слота известны — создаёт матч плей-офф / дружеский.
 * Уже созданные scheduled матчи обновляют состав, если посев группы изменился.
 */
export async function syncFixedPairsBracket(db: Database, tournament: TournamentRow): Promise<boolean> {
  if (!isFixedPairsFormat(tournament.format)) return false;
  const config = parseBracketConfig(tournament.format, tournament.bracketConfig, tournament.pointsToWin);
  if (!config) return false;

  const { pairs } = await loadRegisteredPairs(db, tournament.id);
  const catalog = catalogFromPairs(pairs);
  const lined = await loadLinedMatches(db, tournament.id);
  const ranks = groupRanks(config, catalog, lined);
  const results = slotResults(lined, catalog);
  const existingBySlot = new Map(
    lined.filter((item) => item.match.bracketSlot).map((item) => [item.match.bracketSlot!, item]),
  );

  const fresh: { stage: BracketStage; slotId: string; match: PairMatch }[] = [];
  let changed = false;

  for (const stage of config.stages) {
    for (const slot of stage.slots) {
      const teamA = resolveSourceToken(slot.sourceA, ranks, results);
      const teamB = resolveSourceToken(slot.sourceB, ranks, results);
      if (!teamA || !teamB) continue;

      const existing = existingBySlot.get(slot.id);
      if (existing) {
        if (
          existing.match.status === 'scheduled' &&
          existing.match.scoreA === null &&
          (!sameLineup(existing.teamA, teamA.players) || !sameLineup(existing.teamB, teamB.players))
        ) {
          await replaceLineup(db, existing.match.id, teamA.players, teamB.players);
          changed = true;
        }
        continue;
      }

      fresh.push({
        stage,
        slotId: slot.id,
        match: { teamA, teamB, groupIndex: 0 },
      });
    }
  }

  if (fresh.length === 0) return changed;

  const playoffRounds = openPlayoffRounds(lined, tournament.courts);
  const placed = seatPairMatches(
    fresh.map((item) => item.match),
    playoffRounds,
    tournament.courts,
  );

  const metaOf = (match: PairMatch) =>
    fresh.find(
      (item) => item.match.teamA.id === match.teamA.id && item.match.teamB.id === match.teamB.id,
    );

  for (const seated of placed.seated) {
    const meta = metaOf(seated.match);
    await persistMatchInRound(db, tournament.id, seated.roundIndex, {
      court: seated.court,
      teamA: seated.match.teamA.players,
      teamB: seated.match.teamB.players,
      stage: meta?.stage.kind ?? 'playoff',
      groupIndex: null,
      bracketSlot: meta?.slotId ?? null,
    });
    changed = true;
  }

  const [maxRow] = await db
    .select({ value: max(matches.roundIndex) })
    .from(matches)
    .where(eq(matches.tournamentId, tournament.id));
  let nextIndex = (maxRow?.value ?? -1) + 1;

  for (const round of placed.packed.rounds) {
    await persistRound(db, tournament.id, {
      index: nextIndex,
      sittingOut: [],
      matches: round.map((match) => {
        const meta = metaOf(match);
        return {
          court: match.court,
          teamA: match.teamA.players,
          teamB: match.teamB.players,
          stage: meta?.stage.kind ?? 'playoff',
          groupIndex: null,
          bracketSlot: meta?.slotId ?? null,
        };
      }),
    });
    nextIndex += 1;
    changed = true;
  }

  return changed;
}

function openPlayoffRounds(lined: readonly LinedMatch[], courts: number): OpenPairRound[] {
  const byIndex = new Map<number, OpenPairRound>();
  for (const item of lined) {
    const stage = item.match.stage;
    if (stage !== 'playoff' && stage !== 'consolation') continue;
    const index = item.match.roundIndex;
    const entry = byIndex.get(index) ?? { index, usedCourts: [], pairIds: [] };
    if (item.match.court >= 1 && item.match.court <= courts) {
      entry.usedCourts.push(item.match.court);
    }
    const a = pairIdFromPlayers(item.teamA);
    const b = pairIdFromPlayers(item.teamB);
    if (a) entry.pairIds.push(a);
    if (b) entry.pairIds.push(b);
    byIndex.set(index, entry);
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}
