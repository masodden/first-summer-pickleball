import type { MatchResult, StandingRow, StandingsSortKey } from './types.js';

/** По умолчанию: победы, затем набранные очки, затем разница. */
export const DEFAULT_STANDINGS_SORT: readonly StandingsSortKey[] = ['wins', 'points', 'diff'];

/** Для этих метрик «меньше — лучше». */
const ASCENDING_KEYS: ReadonlySet<StandingsSortKey> = new Set<StandingsSortKey>([
  'losses',
  'pointsAgainst',
]);

function valueOf(row: StandingRow, key: StandingsSortKey): number {
  switch (key) {
    case 'points':
      return row.pointsFor;
    case 'wins':
      return row.wins;
    case 'diff':
      return row.diff;
    case 'losses':
      return row.losses;
    case 'played':
      return row.played;
    case 'pointsAgainst':
      return row.pointsAgainst;
  }
}

export function emptyStandingRow(playerId: string): StandingRow {
  return {
    playerId,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
  };
}

/**
 * Считает таблицу по завершённым матчам. В классическом americano в таблицу идёт
 * сумма набранных очков, поэтому важен именно счёт, а не только факт победы.
 */
export function computeStandings(
  playerIds: readonly string[],
  results: readonly MatchResult[],
  sortKeys: readonly StandingsSortKey[] = DEFAULT_STANDINGS_SORT,
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of playerIds) {
    rows.set(id, emptyStandingRow(id));
  }

  const ensure = (id: string): StandingRow => {
    const existing = rows.get(id);
    if (existing) return existing;
    const created = emptyStandingRow(id);
    rows.set(id, created);
    return created;
  };

  for (const result of results) {
    const { scoreA, scoreB } = result;
    for (const id of result.teamA) {
      const row = ensure(id);
      row.played += 1;
      row.pointsFor += scoreA;
      row.pointsAgainst += scoreB;
      if (scoreA > scoreB) row.wins += 1;
      else if (scoreA < scoreB) row.losses += 1;
      else row.draws += 1;
    }
    for (const id of result.teamB) {
      const row = ensure(id);
      row.played += 1;
      row.pointsFor += scoreB;
      row.pointsAgainst += scoreA;
      if (scoreB > scoreA) row.wins += 1;
      else if (scoreB < scoreA) row.losses += 1;
      else row.draws += 1;
    }
  }

  for (const row of rows.values()) {
    row.diff = row.pointsFor - row.pointsAgainst;
  }

  return sortStandings([...rows.values()], sortKeys);
}

export function sortStandings(
  rows: readonly StandingRow[],
  sortKeys: readonly StandingsSortKey[] = DEFAULT_STANDINGS_SORT,
): StandingRow[] {
  const keys = sortKeys.length > 0 ? sortKeys : DEFAULT_STANDINGS_SORT;
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const diff = valueOf(a, key) - valueOf(b, key);
      if (diff !== 0) {
        return ASCENDING_KEYS.has(key) ? diff : -diff;
      }
    }
    // Гарантируем стабильный порядок, иначе таблица будет «дёргаться» при обновлениях.
    return a.playerId.localeCompare(b.playerId);
  });
}

export type Medal = 'gold' | 'silver' | 'bronze';

/**
 * Медали получают первые три строки отсортированной таблицы.
 * Игроки без сыгранных матчей медалей не получают.
 */
export function resolveMedals(rows: readonly StandingRow[]): (Medal | null)[] {
  const order: Medal[] = ['gold', 'silver', 'bronze'];
  return rows.map((row, index) => {
    if (index > 2 || row.played === 0) return null;
    return order[index] as Medal;
  });
}
