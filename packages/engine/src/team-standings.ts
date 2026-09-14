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

/** Почему пары с равными победами стоят в таком порядке — цепочка USAP / PPA. */
export const TEAM_TIE_BREAK_KINDS = [
  'headToHead',
  'miniLeague',
  'circularDiff',
  'pointDiff',
  'headToHeadDiff',
  'vsNextHighest',
  'pointsFor',
] as const;
export type TeamTieBreakKind = (typeof TEAM_TIE_BREAK_KINDS)[number];

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
  /** На верхней строке ничейной группы; иначе null. */
  tieBreak: TeamTieBreakKind | null;
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
    tieBreak: null,
  };
}

function amongTied(
  results: readonly TeamMatchResult[],
  tiedIds: ReadonlySet<string>,
): TeamMatchResult[] {
  return results.filter(
    (item) => tiedIds.has(item.teamA.id) && tiedIds.has(item.teamB.id),
  );
}

function miniLeagueWins(
  pair: EnginePair,
  results: readonly TeamMatchResult[],
  tiedIds: ReadonlySet<string>,
): number {
  let wins = 0;
  for (const result of amongTied(results, tiedIds)) {
    if (result.teamA.id === pair.id && result.scoreA > result.scoreB) wins += 1;
    if (result.teamB.id === pair.id && result.scoreB > result.scoreA) wins += 1;
  }
  return wins;
}

function pointDiffAgainst(
  pair: EnginePair,
  results: readonly TeamMatchResult[],
  opponentIds: ReadonlySet<string>,
): number {
  let diff = 0;
  for (const result of results) {
    if (result.teamA.id === pair.id && opponentIds.has(result.teamB.id)) {
      diff += result.pointsA - result.pointsB;
    } else if (result.teamB.id === pair.id && opponentIds.has(result.teamA.id)) {
      diff += result.pointsB - result.pointsA;
    }
  }
  return diff;
}

function nextHighestWins(wins: number, all: readonly TeamStandingRow[]): number | null {
  const higher = all.map((row) => row.wins).filter((value) => value > wins);
  if (higher.length === 0) return null;
  return Math.min(...higher);
}

interface TieMetrics {
  h2hWins: number;
  diff: number;
  h2hDiff: number;
  vsNext: number;
  pointsFor: number;
  rating: number;
  id: string;
}

function metricsFor(
  row: TeamStandingRow,
  tied: readonly TeamStandingRow[],
  all: readonly TeamStandingRow[],
  results: readonly TeamMatchResult[],
): TieMetrics {
  const tiedIds = new Set(tied.map((item) => item.pair.id));
  const nextWins = nextHighestWins(row.wins, all);
  const nextIds = new Set(
    nextWins === null
      ? []
      : all.filter((item) => item.wins === nextWins).map((item) => item.pair.id),
  );
  return {
    h2hWins: miniLeagueWins(row.pair, results, tiedIds),
    diff: row.diff,
    h2hDiff: pointDiffAgainst(row.pair, results, tiedIds),
    vsNext: nextIds.size === 0 ? 0 : pointDiffAgainst(row.pair, results, nextIds),
    pointsFor: row.pointsFor,
    rating: row.pair.rating ?? 0,
    id: row.pair.id,
  };
}

type InternalKind =
  | 'headToHeadWins'
  | 'pointDiff'
  | 'headToHeadDiff'
  | 'vsNextHighest'
  | 'pointsFor'
  | 'rating'
  | 'id';

function compareMetrics(a: TieMetrics, b: TieMetrics): { cmp: number; kind: InternalKind } {
  if (a.h2hWins !== b.h2hWins) return { cmp: b.h2hWins - a.h2hWins, kind: 'headToHeadWins' };
  if (a.diff !== b.diff) return { cmp: b.diff - a.diff, kind: 'pointDiff' };
  if (a.h2hDiff !== b.h2hDiff) return { cmp: b.h2hDiff - a.h2hDiff, kind: 'headToHeadDiff' };
  if (a.vsNext !== b.vsNext) return { cmp: b.vsNext - a.vsNext, kind: 'vsNextHighest' };
  if (a.pointsFor !== b.pointsFor) return { cmp: b.pointsFor - a.pointsFor, kind: 'pointsFor' };
  if (a.rating !== b.rating) return { cmp: b.rating - a.rating, kind: 'rating' };
  return { cmp: a.id.localeCompare(b.id), kind: 'id' };
}

function clusterKind(
  tied: readonly TeamStandingRow[],
  all: readonly TeamStandingRow[],
  results: readonly TeamMatchResult[],
): TeamTieBreakKind | null {
  if (tied.length < 2) return null;
  if (tied.every((row) => row.played === 0)) return null;
  const scored = tied.map((row) => metricsFor(row, tied, all, results));
  const fields: { kind: InternalKind; values: number[] }[] = [
    { kind: 'headToHeadWins', values: scored.map((item) => item.h2hWins) },
    { kind: 'pointDiff', values: scored.map((item) => item.diff) },
    { kind: 'headToHeadDiff', values: scored.map((item) => item.h2hDiff) },
    { kind: 'vsNextHighest', values: scored.map((item) => item.vsNext) },
    { kind: 'pointsFor', values: scored.map((item) => item.pointsFor) },
  ];
  const decided = fields.find((field) => field.values.some((value) => value !== field.values[0]));
  if (!decided) return null;
  if (decided.kind === 'headToHeadWins') return tied.length === 2 ? 'headToHead' : 'miniLeague';
  if (decided.kind === 'pointDiff') {
    const tiedIds = new Set(tied.map((row) => row.pair.id));
    const playedAmong = amongTied(results, tiedIds).length > 0;
    return playedAmong && tied.length >= 3 ? 'circularDiff' : 'pointDiff';
  }
  if (decided.kind === 'headToHeadDiff') return 'headToHeadDiff';
  if (decided.kind === 'vsNextHighest') return 'vsNextHighest';
  return 'pointsFor';
}

/**
 * Таблица группы по USAP / PPA: победы → личные среди ничейных → общая разница
 * → разница в личных → разница против следующей по победам → забитые.
 * Пустая таблица и неразводимый остаток — по посеву (суммарный DUPR), без подписи.
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
    tied.sort((a, b) => compareMetrics(metricsFor(a, tied, list, results), metricsFor(b, tied, list, results)).cmp);
    const kind = clusterKind(tied, list, results);
    tied.forEach((row, index) => {
      ordered.push({ ...row, tieBreak: index === 0 ? kind : null });
    });
  }
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function pairIdFromPlayers(ids: readonly string[]): string | null {
  if (ids.length < 2) return null;
  const [a, b] = ids;
  if (!a || !b) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
