import { createRng, type Rng } from './rng.js';

export type SeatPair = readonly [number, number];

export interface SeatMatch {
  court: number;
  teamA: SeatPair;
  teamB: SeatPair;
}

export interface SeatRound {
  index: number;
  matches: SeatMatch[];
  sittingOut: number[];
}

/**
 * Круговой метод: раскладывает `size` мест (size чётное) на `size - 1` раундов,
 * в каждом раунде каждое место попадает ровно в одну пару, и за все раунды
 * каждое место оказывается в паре с каждым другим ровно один раз.
 *
 * Это классическое 1-факторизование полного графа — именно оно даёт americano,
 * где каждый играет в паре с каждым.
 */
export function oneFactorization(size: number): SeatPair[][] {
  if (size % 2 !== 0) {
    throw new Error('oneFactorization требует чётное количество мест');
  }
  const anchor = size - 1;
  const rotating = size - 1;
  const rounds: SeatPair[][] = [];

  for (let round = 0; round < size - 1; round += 1) {
    const pairs: SeatPair[] = [[anchor, round]];
    for (let offset = 1; offset < size / 2; offset += 1) {
      const left = (round + offset) % rotating;
      const right = (round - offset + rotating) % rotating;
      pairs.push([left, right]);
    }
    rounds.push(pairs);
  }

  return rounds;
}

const seatPairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Все способы разбить список пар на матчи по две пары. Для 6 пар это 15 вариантов. */
function* enumerateGroupings(pairs: readonly SeatPair[]): Generator<SeatPair[][]> {
  if (pairs.length === 0) {
    yield [];
    return;
  }
  const [first, ...rest] = pairs as [SeatPair, ...SeatPair[]];
  for (let index = 0; index < rest.length; index += 1) {
    const partner = rest[index] as SeatPair;
    const remaining = rest.filter((_, position) => position !== index);
    for (const tail of enumerateGroupings(remaining)) {
      yield [[first, partner], ...tail];
    }
  }
}

/** Сколько раз в идеале каждая пара мест должна оказаться по разные стороны сетки. */
function opponentTarget(size: number, rounds: number): number {
  return Math.ceil((2 * rounds) / (size - 1));
}

const OVER_TARGET_PENALTY = 10_000;

function groupingCost(
  grouping: readonly SeatPair[][],
  counts: ReadonlyMap<string, number>,
  target: number,
): number {
  let cost = 0;
  for (const [teamA, teamB] of grouping as [SeatPair, SeatPair][]) {
    for (const a of teamA) {
      for (const b of teamB) {
        const current = counts.get(seatPairKey(a, b)) ?? 0;
        // Рост суммы квадратов: выравнивает распределение соперников.
        cost += 2 * current + 1;
        if (current >= target) cost += OVER_TARGET_PENALTY;
      }
    }
  }
  return cost;
}

function applyGrouping(grouping: readonly SeatPair[][], counts: Map<string, number>): SeatMatch[] {
  const matches: SeatMatch[] = [];
  for (const [teamA, teamB] of grouping as [SeatPair, SeatPair][]) {
    for (const a of teamA) {
      for (const b of teamB) {
        const key = seatPairKey(a, b);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    matches.push({ court: matches.length + 1, teamA, teamB });
  }
  return matches;
}

/** Худший показатель: сколько раз одни и те же места чаще всего оказывались соперниками. */
function maxOpponentCount(counts: ReadonlyMap<string, number>): number {
  let max = 0;
  for (const value of counts.values()) max = Math.max(max, value);
  return max;
}

function sumOfSquares(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of counts.values()) total += value * value;
  return total;
}

function buildAttempt(
  factorization: readonly SeatPair[][],
  order: readonly number[],
  target: number,
): { rounds: SeatRound[]; max: number; spread: number } {
  const counts = new Map<string, number>();
  const rounds: SeatRound[] = [];

  order.forEach((factorIndex, roundIndex) => {
    const pairs = factorization[factorIndex] as SeatPair[];
    let bestGrouping: SeatPair[][] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const grouping of enumerateGroupings(pairs)) {
      const cost = groupingCost(grouping, counts, target);
      if (cost < bestCost) {
        bestCost = cost;
        bestGrouping = grouping;
      }
    }

    const matches = applyGrouping(bestGrouping ?? [], counts);
    rounds.push({ index: roundIndex, matches, sittingOut: [] });
  });

  return { rounds, max: maxOpponentCount(counts), spread: sumOfSquares(counts) };
}

/** Чем больше мест, тем дороже перебор, поэтому число попыток снижается. */
function attemptsFor(size: number): number {
  if (size <= 12) return 240;
  if (size <= 16) return 60;
  if (size <= 20) return 16;
  return 4;
}

/**
 * Точное расписание americano на абстрактных местах.
 *
 * Партнёрство задаётся факторизацией и всегда идеально: каждый с каждым по разу.
 * Порядок раундов и разбиение пар на матчи перебираются, чтобы ещё и соперники
 * распределялись как можно ровнее.
 */
export function buildSeatSchedule(
  size: number,
  courts: number,
  rounds: number,
  rng: Rng = createRng(1),
): SeatRound[] {
  const factorization = oneFactorization(size);
  const matchesPerRound = Math.min(courts, size / 4);

  // Полный перебор группировок имеет смысл, только когда все пары выходят на корты.
  if (matchesPerRound < size / 4) {
    return buildGreedySeatSchedule(factorization, matchesPerRound, rounds);
  }

  const target = opponentTarget(size, rounds);
  const identity = Array.from({ length: factorization.length }, (_, index) => index);

  let best = buildAttempt(factorization, identity.slice(0, rounds), target);

  for (let attempt = 1; attempt < attemptsFor(size); attempt += 1) {
    const order = rng.shuffle(identity).slice(0, rounds);
    const candidate = buildAttempt(factorization, order, target);
    const better =
      candidate.max < best.max || (candidate.max === best.max && candidate.spread < best.spread);
    if (better) best = candidate;
    if (best.max <= target && best.spread === 0) break;
  }

  return best.rounds;
}

/** Запасной путь: кортов меньше, чем нужно, поэтому часть пар отдыхает. */
function buildGreedySeatSchedule(
  factorization: readonly SeatPair[][],
  matchesPerRound: number,
  rounds: number,
): SeatRound[] {
  const counts = new Map<string, number>();
  const result: SeatRound[] = [];

  for (let index = 0; index < rounds; index += 1) {
    const pairs = [...(factorization[index % factorization.length] as SeatPair[])];
    const matches: SeatMatch[] = [];

    while (pairs.length >= 2 && matches.length < matchesPerRound) {
      const teamA = pairs.shift() as SeatPair;
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let position = 0; position < pairs.length; position += 1) {
        const candidate = pairs[position] as SeatPair;
        let cost = 0;
        for (const a of teamA) {
          for (const b of candidate) {
            cost += counts.get(seatPairKey(a, b)) ?? 0;
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = position;
        }
      }
      const teamB = pairs.splice(bestIndex, 1)[0] as SeatPair;
      for (const a of teamA) {
        for (const b of teamB) {
          const key = seatPairKey(a, b);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      matches.push({ court: matches.length + 1, teamA, teamB });
    }

    result.push({ index, matches, sittingOut: pairs.flatMap((pair) => [...pair]) });
  }

  return result;
}
