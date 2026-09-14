import { describe, expect, it } from 'vitest';
import { makePair, type EnginePair } from './fixed-pairs.js';
import { computeTeamStandings, type TeamMatchResult } from './team-standings.js';

function pair(tag: string): EnginePair {
  return makePair(`${tag}a`, `${tag}b`);
}

function match(
  teamA: EnginePair,
  teamB: EnginePair,
  pointsA: number,
  pointsB: number,
): TeamMatchResult {
  return {
    teamA,
    teamB,
    scoreA: pointsA > pointsB ? 1 : 0,
    scoreB: pointsB > pointsA ? 1 : 0,
    pointsA,
    pointsB,
    groupIndex: 0,
  };
}

describe('computeTeamStandings USAP/PPA', () => {
  it('при равенстве побед двух пар смотрит личную встречу', () => {
    const a = pair('A');
    const b = pair('B');
    const c = pair('C');
    const d = pair('D');
    const table = computeTeamStandings(
      [a, b, c, d],
      [
        match(a, b, 11, 9),
        match(a, c, 11, 5),
        match(a, d, 5, 11),
        match(b, c, 11, 5),
        match(b, d, 11, 5),
        match(c, d, 11, 9),
      ],
      0,
    );
    const tied = table.filter((row) => row.wins === 2);
    expect(tied.map((row) => row.pair.id)).toEqual([a.id, b.id]);
    expect(tied[0]!.tieBreak).toBe('headToHead');
  });

  it('трое по кругу: личные равны, места считает общая разница', () => {
    const a = pair('A');
    const b = pair('B');
    const c = pair('C');
    const table = computeTeamStandings(
      [a, b, c],
      [
        match(a, b, 11, 5),
        match(a, c, 8, 11),
        match(b, c, 11, 9),
      ],
      0,
    );
    expect(table.map((row) => row.pair.id)).toEqual([a.id, c.id, b.id]);
    expect(table.map((row) => row.diff)).toEqual([3, 1, -4]);
    expect(table[0]!.tieBreak).toBe('circularDiff');
  });

  it('трое с одинаковыми победами: sweep важнее общей разницы', () => {
    const a = pair('A');
    const b = pair('B');
    const c = pair('C');
    const d = pair('D');
    const e = pair('E');
    const table = computeTeamStandings(
      [a, b, c, d, e],
      [
        match(a, b, 11, 9),
        match(a, c, 11, 9),
        match(a, d, 5, 11),
        match(a, e, 5, 11),
        match(b, c, 11, 9),
        match(b, d, 11, 5),
        match(b, e, 9, 11),
        match(c, d, 11, 5),
        match(c, e, 11, 5),
        match(d, e, 5, 11),
      ],
      0,
    );
    const tied = table.filter((row) => row.wins === 2);
    expect(tied.map((row) => row.pair.id)).toEqual([a.id, b.id, c.id]);
    expect(tied[0]!.diff).toBeLessThan(tied[2]!.diff);
    expect(tied[0]!.tieBreak).toBe('miniLeague');
  });

  it('круговая ничья с равной разницей: смотрит матчи с лидером', () => {
    const a = pair('A');
    const b = pair('B');
    const c = pair('C');
    const d = pair('D');
    const e = pair('E');
    const table = computeTeamStandings(
      [a, b, c, d, e],
      [
        match(a, b, 11, 9),
        match(b, c, 11, 9),
        match(c, a, 11, 9),
        match(d, a, 11, 5),
        match(d, b, 11, 8),
        match(d, c, 11, 10),
        match(a, e, 11, 5),
        match(b, e, 11, 8),
        match(c, e, 11, 10),
        match(d, e, 11, 5),
      ],
      0,
    );
    expect(table[0]!.pair.id).toBe(d.id);
    const tied = table.filter((row) => row.wins === 2);
    expect(tied.map((row) => row.pair.id)).toEqual([c.id, b.id, a.id]);
    expect(tied[0]!.tieBreak).toBe('vsNextHighest');
  });

  it('пустая таблица: порядок по посеву, не по id', () => {
    const strong = makePair('zz', 'yy', 7.1);
    const mid = makePair('mm', 'nn', 6.4);
    const weak = makePair('aa', 'bb', 5.2);
    const table = computeTeamStandings([weak, strong, mid], [], 0);
    expect(table.map((row) => row.pair.id)).toEqual([strong.id, mid.id, weak.id]);
    expect(table.every((row) => row.tieBreak === null)).toBe(true);
  });

  it('трое выиграли у разных соперников: это разница очков, не круг', () => {
    const a = pair('A');
    const b = pair('B');
    const c = pair('C');
    const d = pair('D');
    const e = pair('E');
    const f = pair('F');
    const table = computeTeamStandings(
      [a, b, c, d, e, f],
      [match(a, d, 11, 4), match(b, e, 11, 7), match(c, f, 11, 7)],
      0,
    );
    const winners = table.filter((row) => row.wins === 1);
    const losers = table.filter((row) => row.wins === 0);
    expect(winners.map((row) => row.pair.id)).toEqual([a.id, b.id, c.id]);
    expect(winners[0]!.tieBreak).toBe('pointDiff');
    expect(losers[0]!.tieBreak).toBe('pointDiff');
  });
});
