import { describe, expect, it } from 'vitest';
import { canUseExactSchedule, describeSchedule, generateAmericanoSchedule } from './americano.js';
import { oneFactorization } from './pairings.js';
import { ScheduleError, type EnginePlayer, type SchedulePlan } from './types.js';

function makePlayers(count: number, ratings?: readonly (number | null)[]): EnginePlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${String(index + 1).padStart(2, '0')}`,
    rating: ratings ? (ratings[index] ?? null) : 4 + (index % 5) * 0.25,
  }));
}

function partnerPairs(schedule: SchedulePlan): string[] {
  const pairs: string[] = [];
  for (const round of schedule) {
    for (const match of round.matches) {
      for (const team of [match.teamA, match.teamB]) {
        const [a, b] = team;
        pairs.push(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  }
  return pairs;
}

function gamesPerPlayer(schedule: SchedulePlan): Map<string, number> {
  const games = new Map<string, number>();
  for (const round of schedule) {
    for (const match of round.matches) {
      for (const id of [...match.teamA, ...match.teamB]) {
        games.set(id, (games.get(id) ?? 0) + 1);
      }
    }
  }
  return games;
}

describe('oneFactorization', () => {
  it('разбивает 12 мест на 11 раундов, где каждая пара встречается ровно один раз', () => {
    const rounds = oneFactorization(12);
    expect(rounds).toHaveLength(11);

    const seen = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(6);
      const used = new Set<number>();
      for (const [a, b] of round) {
        // Внутри раунда каждое место участвует ровно один раз.
        expect(used.has(a)).toBe(false);
        expect(used.has(b)).toBe(false);
        used.add(a);
        used.add(b);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(used.size).toBe(12);
    }
    // Всего сочетаний из 12 по 2.
    expect(seen.size).toBe(66);
  });

  it('работает для любого чётного размера', () => {
    for (const size of [4, 8, 16, 20]) {
      const rounds = oneFactorization(size);
      expect(rounds).toHaveLength(size - 1);
      expect(rounds[0]).toHaveLength(size / 2);
    }
  });

  it('отказывается работать с нечётным числом мест', () => {
    expect(() => oneFactorization(7)).toThrow();
  });
});

describe('generateAmericanoSchedule — целевой сценарий 12 игроков и 3 корта', () => {
  const players = makePlayers(12);
  const schedule = generateAmericanoSchedule({
    players,
    courts: 3,
    rounds: 11,
    ratingBalance: true,
    seed: 42,
  });

  it('использует точную конструкцию', () => {
    expect(canUseExactSchedule(12, 3, 11)).toBe(true);
  });

  it('создаёт 11 раундов по 3 матча без отдыхающих', () => {
    expect(schedule).toHaveLength(11);
    for (const round of schedule) {
      expect(round.matches).toHaveLength(3);
      expect(round.sittingOut).toHaveLength(0);
      expect(round.matches.map((match) => match.court)).toEqual([1, 2, 3]);
    }
  });

  it('каждый играет в паре с каждым ровно один раз', () => {
    const pairs = partnerPairs(schedule);
    expect(pairs).toHaveLength(66);
    expect(new Set(pairs).size).toBe(66);

    const stats = describeSchedule(schedule, players);
    expect(stats.maxPartnerRepeats).toBe(0);
  });

  it('все играют одинаковое количество матчей', () => {
    const games = gamesPerPlayer(schedule);
    expect(games.size).toBe(12);
    for (const count of games.values()) {
      expect(count).toBe(11);
    }
  });

  it('в каждом раунде каждый игрок занят не больше одного раза', () => {
    for (const round of schedule) {
      const used = new Set<string>();
      for (const match of round.matches) {
        for (const id of [...match.teamA, ...match.teamB]) {
          expect(used.has(id)).toBe(false);
          used.add(id);
        }
      }
      expect(used.size).toBe(12);
    }
  });

  it('соперники повторяются не больше двух раз — это предел для такого формата', () => {
    const stats = describeSchedule(schedule, players);
    expect(stats.maxOpponentRepeats).toBeLessThanOrEqual(2);
  });
});

describe('generateAmericanoSchedule — другие ровные составы', () => {
  it.each([
    [8, 2, 7],
    [16, 4, 15],
    [20, 5, 19],
  ])('%i игроков на %i кортах за %i раундов не повторяет партнёров', (count, courts, rounds) => {
    const players = makePlayers(count);
    const schedule = generateAmericanoSchedule({ players, courts, rounds, seed: 7 });
    const stats = describeSchedule(schedule, players);
    expect(stats.maxPartnerRepeats).toBe(0);
    expect(stats.gamesPlayedSpread).toBe(0);
  });

  it('позволяет играть меньше раундов, чем полный круг', () => {
    const players = makePlayers(12);
    const schedule = generateAmericanoSchedule({ players, courts: 3, rounds: 5, seed: 3 });
    expect(schedule).toHaveLength(5);
    expect(describeSchedule(schedule, players).maxPartnerRepeats).toBe(0);
  });
});

describe('generateAmericanoSchedule — сидауты', () => {
  it('честно ротирует отдыхающих, когда игроков больше, чем мест', () => {
    const players = makePlayers(14);
    const schedule = generateAmericanoSchedule({ players, courts: 3, rounds: 11, seed: 11 });

    for (const round of schedule) {
      expect(round.matches).toHaveLength(3);
      expect(round.sittingOut).toHaveLength(2);
    }

    const stats = describeSchedule(schedule, players);
    // Разница в числе сыгранных матчей не больше одного.
    expect(stats.gamesPlayedSpread).toBeLessThanOrEqual(1);
    expect(stats.maxPartnerRepeats).toBeLessThanOrEqual(1);
  });

  it('никто не отдыхает два раунда подряд, если есть кому его заменить', () => {
    const players = makePlayers(13);
    const schedule = generateAmericanoSchedule({ players, courts: 3, rounds: 13, seed: 5 });
    for (let index = 1; index < schedule.length; index += 1) {
      const previous = new Set(schedule[index - 1]!.sittingOut);
      const current = schedule[index]!.sittingOut;
      const repeated = current.filter((id) => previous.has(id));
      expect(repeated).toHaveLength(0);
    }
  });

  it('ограничивает число матчей количеством кортов', () => {
    const players = makePlayers(16);
    const schedule = generateAmericanoSchedule({ players, courts: 2, rounds: 6, seed: 9 });
    for (const round of schedule) {
      expect(round.matches).toHaveLength(2);
      expect(round.sittingOut).toHaveLength(8);
    }
  });
});

describe('generateAmericanoSchedule — балансировка по рейтингу', () => {
  it('выравнивает силу пар лучше, чем случайная расстановка', () => {
    const ratings = [6.5, 6.4, 6.2, 6.0, 5.0, 4.9, 4.8, 4.7, 3.2, 3.1, 3.0, 2.9];
    const players = makePlayers(12, ratings);

    const balanced = generateAmericanoSchedule({
      players,
      courts: 3,
      rounds: 11,
      ratingBalance: true,
      seed: 21,
    });
    const random = generateAmericanoSchedule({
      players,
      courts: 3,
      rounds: 11,
      ratingBalance: false,
      seed: 21,
    });

    const balancedImbalance = describeSchedule(balanced, players).totalImbalance;
    const randomImbalance = describeSchedule(random, players).totalImbalance;
    expect(balancedImbalance).toBeLessThan(randomImbalance);
    // Комбинаторные свойства при этом не страдают.
    expect(describeSchedule(balanced, players).maxPartnerRepeats).toBe(0);
  });

  it('не падает, когда ни у кого нет рейтинга', () => {
    const players = makePlayers(
      12,
      Array.from({ length: 12 }, () => null),
    );
    const schedule = generateAmericanoSchedule({
      players,
      courts: 3,
      rounds: 11,
      ratingBalance: true,
      seed: 4,
    });
    expect(describeSchedule(schedule, players).maxPartnerRepeats).toBe(0);
  });

  it('подставляет медиану игрокам без рейтинга', () => {
    const ratings: (number | null)[] = [6, 6, 5.5, 5.5, null, null, 3, 3, 4, 4, 4.5, 4.5];
    const players = makePlayers(12, ratings);
    const schedule = generateAmericanoSchedule({
      players,
      courts: 3,
      rounds: 11,
      ratingBalance: true,
      seed: 8,
    });
    expect(schedule).toHaveLength(11);
    expect(describeSchedule(schedule, players).maxPartnerRepeats).toBe(0);
  });
});

describe('generateAmericanoSchedule — воспроизводимость и reshuffle', () => {
  it('один и тот же seed даёт одно и то же расписание', () => {
    const players = makePlayers(12);
    const first = generateAmericanoSchedule({ players, courts: 3, rounds: 11, seed: 99 });
    const second = generateAmericanoSchedule({ players, courts: 3, rounds: 11, seed: 99 });
    expect(second).toEqual(first);
  });

  it('другой seed меняет состав пар, сохраняя свойства формата', () => {
    const players = makePlayers(12);
    const first = generateAmericanoSchedule({ players, courts: 3, rounds: 11, seed: 1 });
    const second = generateAmericanoSchedule({ players, courts: 3, rounds: 11, seed: 2 });
    expect(second).not.toEqual(first);
    expect(describeSchedule(second, players).maxPartnerRepeats).toBe(0);
  });
});

describe('generateAmericanoSchedule — ошибки', () => {
  it('требует минимум четырёх игроков', () => {
    expect(() =>
      generateAmericanoSchedule({ players: makePlayers(3), courts: 1, rounds: 3 }),
    ).toThrow(ScheduleError);
  });

  it('требует хотя бы один корт', () => {
    expect(() =>
      generateAmericanoSchedule({ players: makePlayers(8), courts: 0, rounds: 3 }),
    ).toThrow(ScheduleError);
  });

  it('требует положительное количество раундов', () => {
    expect(() =>
      generateAmericanoSchedule({ players: makePlayers(8), courts: 2, rounds: 0 }),
    ).toThrow(ScheduleError);
  });

  it('сообщает код ошибки, чтобы фронт показал понятный тост', () => {
    try {
      generateAmericanoSchedule({ players: makePlayers(2), courts: 1, rounds: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleError);
      expect((error as ScheduleError).code).toBe('not_enough_players');
    }
  });
});
