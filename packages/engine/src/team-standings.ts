import type { EnginePair } from './fixed-pairs.js';

export interface TeamMatchResult {
  teamA: EnginePair;
  teamB: EnginePair;
  scoreA: number;
  scoreB: number;
  pointsA: number;
  pointsB: number;
  groupIndex: number;
}

export interface TeamStandingRow {
  pair: EnginePair;
  groupIndex: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  rank: number;
}

function emptyRow(pair: EnginePair, groupIndex: number): TeamStandingRow {
  return {
    pair,
    groupIndex,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
    rank: 0,
  };
}

function h2h(
  a: EnginePair,
  b: EnginePair,
  results: readonly TeamMatchResult[],
): { wins: number; diff: number } {
  let wins = 0;
  let diff = 0;
  for (const result of results) {
    const aIsA = result.teamA.id === a.id && result.teamB.id === b.id;
    const aIsB = result.teamB.id === a.id && result.teamA.id === b.id;
    if (!aIsA && !aIsB) continue;
    const scoreA = aIsA ? result.scoreA : result.scoreB;
    const scoreB = aIsA ? result.scoreB : result.scoreA;
    const pointsA = aIsA ? result.pointsA : result.pointsB;
    const pointsB = aIsA ? result.pointsB : result.pointsA;
    if (scoreA > scoreB) wins += 1;
    else if (scoreA < scoreB) wins -= 1;
    diff += pointsA - pointsB;
  }
  return { wins, diff };
}

function compareTied(
  a: TeamStandingRow,
  b: TeamStandingRow,
  tied: readonly TeamStandingRow[],
  results: readonly TeamMatchResult[],
): number {
  if (tied.length === 2) {
    const head = h2h(a.pair, b.pair, results);
    if (head.wins !== 0) return -head.wins;
    if (head.diff !== 0) return -head.diff;
  }
  if (a.diff !== b.diff) return b.diff - a.diff;
  const among = results.filter(
    (item) =>
      tied.some((row) => row.pair.id === item.teamA.id) &&
      tied.some((row) => row.pair.id === item.teamB.id),
  );
  const aAmong = h2hSum(a.pair, among);
  const bAmong = h2hSum(b.pair, among);
  if (aAmong.diff !== bAmong.diff) return bAmong.diff - aAmong.diff;
  if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
  return a.pair.id.localeCompare(b.pair.id);
}

function h2hSum(pair: EnginePair, results: readonly TeamMatchResult[]): { diff: number } {
  let diff = 0;
  for (const result of results) {
    if (result.teamA.id === pair.id) diff += result.pointsA - result.pointsB;
    else if (result.teamB.id === pair.id) diff += result.pointsB - result.pointsA;
  }
  return { diff };
}

/**
 * Таблица группы: победы → личная встреча (двое) → разница / очки (трое+).
 */
export function computeTeamStandings(
  pairs: readonly EnginePair[],
  results: readonly TeamMatchResult[],
  groupIndex: number,
): TeamStandingRow[] {
  const rows = new Map<string, TeamStandingRow>();
  for (const pair of pairs) rows.set(pair.id, emptyRow(pair, groupIndex));

  for (const result of results.filter((item) => item.groupIndex === groupIndex)) {
    const a = rows.get(result.teamA.id);
    const b = rows.get(result.teamB.id);
    if (!a || !b) continue;
    a.played += 1;
    b.played += 1;
    a.pointsFor += result.pointsA;
    a.pointsAgainst += result.pointsB;
    b.pointsFor += result.pointsB;
    b.pointsAgainst += result.pointsA;
    a.diff = a.pointsFor - a.pointsAgainst;
    b.diff = b.pointsFor - b.pointsAgainst;
    if (result.scoreA > result.scoreB) {
      a.wins += 1;
      b.losses += 1;
    } else if (result.scoreA < result.scoreB) {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }
  }

  const list = [...rows.values()];
  const byWins = new Map<number, TeamStandingRow[]>();
  for (const row of list) {
    const bucket = byWins.get(row.wins) ?? [];
    bucket.push(row);
    byWins.set(row.wins, bucket);
  }
  const ordered: TeamStandingRow[] = [];
  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const tied = byWins.get(wins)!;
    tied.sort((a, b) => compareTied(a, b, tied, results));
    ordered.push(...tied);
  }
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function pairIdFromPlayers(ids: readonly string[]): string | null {
  if (ids.length < 2) return null;
  const [a, b] = ids;
  if (!a || !b) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
