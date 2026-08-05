import { describe, expect, it } from 'vitest';
import { generateMexicanoRound } from './mexicano.js';
import { emptyStandingRow } from './standings.js';
import { ScheduleError, type EnginePlayer, type StandingRow } from './types.js';

function makePlayers(count: number, ratings?: readonly number[]): EnginePlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${String(index + 1).padStart(2, '0')}`,
    rating: ratings ? (ratings[index] ?? null) : null,
  }));
}

function standingsFor(order: readonly string[]): StandingRow[] {
  return order.map((playerId, index) => ({
    ...emptyStandingRow(playerId),
    played: 1,
    pointsFor: 100 - index,
    diff: 50 - index,
    wins: order.length - index,
  }));
}

describe('generateMexicanoRound', () => {
  it('первый раунд собирает корты по рейтингу: сильнейшие на первом корте', () => {
    const ratings = [6.5, 6.4, 6.3, 6.2, 5.0, 4.9, 4.8, 4.7, 3.5, 3.4, 3.3, 3.2];
    const players = makePlayers(12, ratings);
    const round = generateMexicanoRound({ players, courts: 3, roundIndex: 0, seed: 5 });

    expect(round.matches).toHaveLength(3);
    expect(round.sittingOut).toHaveLength(0);

    const courtOne = round.matches.find((match) => match.court === 1)!;
    const courtOnePlayers = [...courtOne.teamA, ...courtOne.teamB].sort();
    expect(courtOnePlayers).toEqual(['P01', 'P02', 'P03', 'P04']);
  });

  it('внутри корта играет первый с четвёртым против второго с третьим', () => {
    const ratings = [6.5, 6.4, 6.3, 6.2];
    const players = makePlayers(4, ratings);
    const round = generateMexicanoRound({ players, courts: 1, roundIndex: 0, seed: 5 });

    const match = round.matches[0]!;
    expect([...match.teamA].sort()).toEqual(['P01', 'P04']);
    expect([...match.teamB].sort()).toEqual(['P02', 'P03']);
  });

  it('следующие раунды строятся по текущей таблице, а не по рейтингу', () => {
    const players = makePlayers(8, [3, 3, 3, 3, 6, 6, 6, 6]);
    const leaders = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'];
    const round = generateMexicanoRound({
      players,
      courts: 2,
      roundIndex: 1,
      standings: standingsFor(leaders),
      seed: 5,
    });

    const courtOne = round.matches.find((match) => match.court === 1)!;
    expect([...courtOne.teamA, ...courtOne.teamB].sort()).toEqual(['P01', 'P02', 'P03', 'P04']);
  });

  it('отправляет отдыхать тех, кто сыграл больше всех', () => {
    const players = makePlayers(6, [5, 5, 5, 5, 5, 5]);
    const round = generateMexicanoRound({
      players,
      courts: 1,
      roundIndex: 3,
      gamesPlayed: { P01: 3, P02: 3, P03: 1, P04: 1, P05: 1, P06: 1 },
      seed: 5,
    });

    expect(round.matches).toHaveLength(1);
    expect(round.sittingOut.sort()).toEqual(['P01', 'P02']);
  });

  it('не оставляет отдыхать одного и того же два раунда подряд без нужды', () => {
    const players = makePlayers(6, [5, 5, 5, 5, 5, 5]);
    const round = generateMexicanoRound({
      players,
      courts: 1,
      roundIndex: 2,
      gamesPlayed: { P01: 2, P02: 2, P03: 2, P04: 2, P05: 2, P06: 2 },
      satLastRound: ['P01', 'P02'],
      seed: 5,
    });
    expect(round.sittingOut).not.toContain('P01');
    expect(round.sittingOut).not.toContain('P02');
  });

  it('нумерует корты подряд от первого', () => {
    const players = makePlayers(12, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0.9, 0.8, 0.7]);
    const round = generateMexicanoRound({ players, courts: 3, roundIndex: 0, seed: 1 });
    expect(round.matches.map((match) => match.court)).toEqual([1, 2, 3]);
  });

  it('требует минимум четырёх игроков', () => {
    expect(() =>
      generateMexicanoRound({ players: makePlayers(3), courts: 1, roundIndex: 0 }),
    ).toThrow(ScheduleError);
  });

  it('каждый игрок занят не больше одного раза за раунд', () => {
    const players = makePlayers(16, [8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0.5]);
    const round = generateMexicanoRound({ players, courts: 4, roundIndex: 0, seed: 2 });
    const used = new Set<string>();
    for (const match of round.matches) {
      for (const id of [...match.teamA, ...match.teamB]) {
        expect(used.has(id)).toBe(false);
        used.add(id);
      }
    }
    expect(used.size).toBe(16);
  });
});
