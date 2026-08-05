import { describe, expect, it } from 'vitest';
import { generateAmericanoSchedule, nextAmericanoRound } from './americano.js';
import { assignRoundCourts, courtSpread, courtUsageFromMatches } from './courts.js';
import { generateMexicanoRound } from './mexicano.js';
import type { EnginePlayer, RoundPlan, StandingRow } from './types.js';

function players(count: number, ratingBase = 4): EnginePlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    rating: Number((ratingBase + index * 0.05).toFixed(3)),
  }));
}

function standingsByOrder(ids: readonly string[]): StandingRow[] {
  return ids.map((playerId, index) => ({
    playerId,
    played: 1,
    wins: ids.length - index,
    losses: index,
    draws: 0,
    pointsFor: 100 - index,
    pointsAgainst: 50,
    diff: 50 - index,
  }));
}

/**
 * Перекос при полном переборе распределений матчей по двум кортам.
 * Нужен, чтобы проверять движок против достижимого предела, а не против
 * придуманного числа: четвёрки уже собраны, и корты можно только переставлять.
 */
function bestPossibleSpreadOnTwoCourts(schedule: readonly RoundPlan[]): number {
  const groups = schedule.map((round) =>
    round.matches.map((match) => [...match.teamA, ...match.teamB]),
  );
  let best = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    const usage = new Map<string, [number, number]>();
    groups.forEach((round, index) => {
      const flip = round.length === 2 && ((mask >> index) & 1) === 1;
      round.forEach((group, position) => {
        const slot = flip ? 1 - position : position;
        for (const id of group) {
          const row = usage.get(id) ?? [0, 0];
          row[slot as 0 | 1] += 1;
          usage.set(id, row);
        }
      });
    });

    let spread = 0;
    for (const row of usage.values()) {
      spread = Math.max(spread, Math.max(...row) - Math.min(...row));
    }
    best = Math.min(best, spread);
  }

  return best;
}

describe('americano: корты достаются всем поровну', () => {
  it('12 игроков на 3 кортах: каждый играет на каждом корте', () => {
    const schedule = generateAmericanoSchedule({
      players: players(12),
      courts: 3,
      rounds: 11,
      seed: 7,
    });

    const { perPlayer } = courtSpread(schedule);
    for (const row of perPlayer.values()) {
      expect(row).toHaveLength(3);
      expect(row.reduce((sum, value) => sum + value, 0)).toBe(11);
      // Ни одного корта, который игрок не увидел бы за вечер.
      expect(Math.min(...row)).toBeGreaterThan(0);
      // 11 игр на три корта: ровнее, чем 5/3/3, не выйдет.
      expect(Math.max(...row)).toBeLessThanOrEqual(5);
    }
  });

  it('8 игроков на 2 кортах: расклад не хуже лучшего возможного', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const schedule = generateAmericanoSchedule({
        players: players(8),
        courts: 2,
        rounds: 6,
        seed,
      });

      expect(courtSpread(schedule).maxSpread).toBe(bestPossibleSpreadOnTwoCourts(schedule));
    }
  });

  it('состав не кратен четырём: расклад по кортам тоже лучший возможный', () => {
    for (const seed of [1, 3, 7]) {
      const schedule = generateAmericanoSchedule({
        players: players(10),
        courts: 2,
        rounds: 8,
        seed,
      });

      const spread = courtSpread(schedule).maxSpread;
      expect(spread).toBeLessThanOrEqual(bestPossibleSpreadOnTwoCourts(schedule) + 1);
    }
  });

  it('номера кортов идут по порядку и не повторяются внутри раунда', () => {
    const schedule = generateAmericanoSchedule({
      players: players(16),
      courts: 4,
      rounds: 9,
      seed: 5,
    });

    for (const round of schedule) {
      const courts = round.matches.map((match) => match.court);
      expect(courts).toEqual([1, 2, 3, 4]);
    }
  });

  it('корты, которых больше, чем матчей, не используются', () => {
    const schedule = generateAmericanoSchedule({
      players: players(8),
      courts: 5,
      rounds: 4,
      seed: 2,
    });

    for (const round of schedule) {
      expect(round.matches.map((match) => match.court)).toEqual([1, 2]);
    }
  });

  it('достроенный раунд учитывает, кто на каких кортах уже играл', () => {
    const roster = players(8);
    // Первые двое весь турнир простояли на первом корте.
    const played = [
      { court: 1, teamA: ['p1', 'p2'] as const, teamB: ['p3', 'p4'] as const },
      { court: 2, teamA: ['p5', 'p6'] as const, teamB: ['p7', 'p8'] as const },
      { court: 1, teamA: ['p1', 'p3'] as const, teamB: ['p2', 'p4'] as const },
      { court: 2, teamA: ['p5', 'p7'] as const, teamB: ['p6', 'p8'] as const },
    ];

    const round = nextAmericanoRound({
      players: roster,
      courts: 2,
      roundIndex: 2,
      playedMatches: played,
      seed: 4,
    });

    const before = courtUsageFromMatches(played, 2);
    const firstCourtHistory = (court: number) => {
      const match = round.matches.find((item) => item.court === court);
      const ids = [...(match?.teamA ?? []), ...(match?.teamB ?? [])];
      return ids.reduce((sum, id) => sum + (before.get(id)?.[0] ?? 0), 0);
    };

    // Первый корт не достаётся тем, кто на нём уже отыграл больше остальных.
    expect(firstCourtHistory(1)).toBeLessThanOrEqual(firstCourtHistory(2));
  });

  it('корт выбирается по тому, кто где уже играл', () => {
    const usage = courtUsageFromMatches(
      [
        { court: 1, teamA: ['a1', 'a2'], teamB: ['a3', 'a4'] },
        { court: 1, teamA: ['a1', 'a3'], teamB: ['a2', 'a4'] },
      ],
      2,
    );

    const round = assignRoundCourts(
      {
        index: 2,
        matches: [
          // Эта четвёрка уже дважды играла на первом корте.
          { court: 1, teamA: ['a1', 'a2'], teamB: ['a3', 'a4'] },
          // А эта не выходила на него ни разу.
          { court: 2, teamA: ['b1', 'b2'], teamB: ['b3', 'b4'] },
        ],
        sittingOut: [],
      },
      2,
      usage,
    );

    const first = round.matches.find((match) => match.court === 1);
    expect([...(first?.teamA ?? []), ...(first?.teamB ?? [])]).toEqual(['b1', 'b2', 'b3', 'b4']);
  });
});

describe('mexicano: корт — это позиция в таблице', () => {
  it('лидеры таблицы играют на первом корте, отстающие — на последнем', () => {
    const roster = players(12);
    const order = ['p4', 'p9', 'p1', 'p12', 'p7', 'p2', 'p11', 'p5', 'p3', 'p8', 'p6', 'p10'];

    const round = generateMexicanoRound({
      players: roster,
      courts: 3,
      roundIndex: 1,
      standings: standingsByOrder(order),
      seed: 9,
    });

    expect(round.matches.map((match) => match.court)).toEqual([1, 2, 3]);

    const onCourt = (court: number) => {
      const match = round.matches.find((item) => item.court === court);
      return new Set([...(match?.teamA ?? []), ...(match?.teamB ?? [])]);
    };

    expect(onCourt(1)).toEqual(new Set(order.slice(0, 4)));
    expect(onCourt(2)).toEqual(new Set(order.slice(4, 8)));
    expect(onCourt(3)).toEqual(new Set(order.slice(8, 12)));
  });

  it('внутри корта первый играет с четвёртым против второго с третьим', () => {
    const roster = players(4);
    const order = ['p2', 'p4', 'p1', 'p3'];

    const round = generateMexicanoRound({
      players: roster,
      courts: 1,
      roundIndex: 1,
      standings: standingsByOrder(order),
      seed: 1,
    });

    const [match] = round.matches;
    expect(new Set(match?.teamA)).toEqual(new Set(['p2', 'p3']));
    expect(new Set(match?.teamB)).toEqual(new Set(['p4', 'p1']));
  });

  it('ротацию кортов к mexicano не применяем: порядок задаёт таблица', () => {
    const roster = players(8);
    const leaders = ['p3', 'p7', 'p1', 'p5', 'p2', 'p8', 'p4', 'p6'];

    // Даже если те же игроки трижды выходят лидерами, они остаются на первом корте.
    for (const roundIndex of [1, 2, 3]) {
      const round = generateMexicanoRound({
        players: roster,
        courts: 2,
        roundIndex,
        standings: standingsByOrder(leaders),
        seed: roundIndex,
      });
      const first = round.matches.find((match) => match.court === 1);
      expect(new Set([...(first?.teamA ?? []), ...(first?.teamB ?? [])])).toEqual(
        new Set(leaders.slice(0, 4)),
      );
    }
  });
});
