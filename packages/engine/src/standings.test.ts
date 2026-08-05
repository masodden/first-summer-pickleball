import { describe, expect, it } from 'vitest';
import {
  computeStandings,
  DEFAULT_STANDINGS_SORT,
  resolveMedals,
  sortStandings,
} from './standings.js';
import type { MatchResult } from './types.js';

const players = ['A', 'B', 'C', 'D'];

const results: MatchResult[] = [
  { teamA: ['A', 'B'], teamB: ['C', 'D'], scoreA: 11, scoreB: 6 },
  { teamA: ['A', 'C'], teamB: ['B', 'D'], scoreA: 11, scoreB: 9 },
  { teamA: ['A', 'D'], teamB: ['B', 'C'], scoreA: 8, scoreB: 11 },
];

describe('computeStandings', () => {
  it('складывает набранные очки, победы и поражения', () => {
    const rows = computeStandings(players, results);
    const byId = new Map(rows.map((row) => [row.playerId, row]));

    const a = byId.get('A')!;
    expect(a.played).toBe(3);
    expect(a.pointsFor).toBe(11 + 11 + 8);
    expect(a.pointsAgainst).toBe(6 + 9 + 11);
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(1);
    expect(a.diff).toBe(30 - 26);

    const b = byId.get('B')!;
    expect(b.wins).toBe(2);
    expect(b.pointsFor).toBe(11 + 9 + 11);
  });

  it('учитывает ничьи отдельно от побед и поражений', () => {
    const rows = computeStandings(players, [
      { teamA: ['A', 'B'], teamB: ['C', 'D'], scoreA: 10, scoreB: 10 },
    ]);
    for (const row of rows) {
      expect(row.draws).toBe(1);
      expect(row.wins).toBe(0);
      expect(row.losses).toBe(0);
    }
  });

  it('показывает игроков без матчей с нулями, а не пропускает их', () => {
    const rows = computeStandings([...players, 'E'], results);
    const e = rows.find((row) => row.playerId === 'E')!;
    expect(e.played).toBe(0);
    expect(e.pointsFor).toBe(0);
  });

  it('по умолчанию сортирует по победам, затем очкам, затем разнице', () => {
    expect(DEFAULT_STANDINGS_SORT).toEqual(['wins', 'points', 'diff']);
    const rows = computeStandings(players, results);
    // У A и B по две победы, но у B больше набранных очков.
    expect(rows[0]!.playerId).toBe('B');
    expect(rows[1]!.playerId).toBe('A');
  });
});

describe('sortStandings', () => {
  const rows = computeStandings(players, results);

  it('умеет сортировать по очкам', () => {
    const sorted = sortStandings(rows, ['points']);
    const points = sorted.map((row) => row.pointsFor);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it('сортирует поражения и пропущенные очки по возрастанию: меньше — лучше', () => {
    const byLosses = sortStandings(rows, ['losses']);
    const losses = byLosses.map((row) => row.losses);
    expect(losses).toEqual([...losses].sort((a, b) => a - b));

    const byConceded = sortStandings(rows, ['pointsAgainst']);
    const conceded = byConceded.map((row) => row.pointsAgainst);
    expect(conceded).toEqual([...conceded].sort((a, b) => a - b));
  });

  it('даёт стабильный порядок при полном равенстве, чтобы таблица не дёргалась', () => {
    const tied = computeStandings(['X', 'Y', 'Z'], []);
    expect(tied.map((row) => row.playerId)).toEqual(['X', 'Y', 'Z']);
    expect(sortStandings(tied, ['points', 'wins']).map((row) => row.playerId)).toEqual([
      'X',
      'Y',
      'Z',
    ]);
  });
});

describe('resolveMedals', () => {
  it('выдаёт медали первым трём', () => {
    const rows = computeStandings(players, results);
    expect(resolveMedals(rows)).toEqual(['gold', 'silver', 'bronze', null]);
  });

  it('не награждает тех, кто не сыграл ни одного матча', () => {
    const rows = computeStandings(['A', 'B'], []);
    expect(resolveMedals(rows)).toEqual([null, null]);
  });
});
