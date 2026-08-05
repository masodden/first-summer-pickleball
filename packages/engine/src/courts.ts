import type { Rng } from './rng.js';
import type { MatchPlan, RoundPlan } from './types.js';

/**
 * Распределение матчей по кортам.
 *
 * Корты не равноценны: на одном ровное покрытие, другой продувает, у третьего
 * шумно. Если оставить тот порядок, в котором расписание построилось, часть
 * игроков весь вечер простоит на одном и том же корте. Поэтому в americano
 * матчи раунда раскидываются так, чтобы каждый успел побывать на всех кортах
 * примерно одинаково.
 *
 * В mexicano порядок кортов трогать нельзя: он и есть смысл формата — лидеры
 * играют на первом корте, проигравшие опускаются ниже.
 *
 * Предел возможного: четвёрки уже собраны так, чтобы каждый сыграл в паре с
 * каждым и поменьше повторял соперников, а корты распределяются по готовым
 * четвёркам. Поэтому идеального «поровну» не всегда достичь: при семи раундах
 * на двух кортах структура пар сама по себе даёт перекос. Здесь мы находим
 * лучший расклад из возможных, не ломая качество самих пар — оно для игры
 * важнее, чем корт.
 */

/** Сколько раз каждый игрок сыграл на каждом корте. */
export type CourtUsage = Map<string, number[]>;

interface CourtMatch {
  court: number;
  teamA: readonly string[];
  teamB: readonly string[];
}

const playersOf = (match: CourtMatch): string[] => [...match.teamA, ...match.teamB];

function usageRow(usage: CourtUsage, playerId: string, courts: number): number[] {
  const existing = usage.get(playerId);
  if (existing && existing.length >= courts) return existing;
  const row = Array.from({ length: courts }, (_, index) => existing?.[index] ?? 0);
  usage.set(playerId, row);
  return row;
}

export function courtUsageFromMatches(matches: readonly CourtMatch[], courts: number): CourtUsage {
  const usage: CourtUsage = new Map();
  for (const match of matches) {
    applyMatch(usage, match, match.court - 1, courts, 1);
  }
  return usage;
}

function applyMatch(
  usage: CourtUsage,
  match: CourtMatch,
  slot: number,
  courts: number,
  delta: number,
): void {
  if (slot < 0 || slot >= courts) return;
  for (const playerId of playersOf(match)) {
    const row = usageRow(usage, playerId, courts);
    row[slot] = (row[slot] ?? 0) + delta;
  }
}

/**
 * Насколько дорого поставить эти матчи на эти корты.
 *
 * Считаем прирост суммы квадратов: перевести игрока с корта, где он был трижды,
 * дороже, чем с корта, где он был один раз. Прирост от `c` до `c + 1` равен
 * `2c + 1`, поэтому сравнение вариантов сводится к сумме уже сыгранного.
 */
function orderCost(
  matches: readonly CourtMatch[],
  order: readonly number[],
  usage: CourtUsage,
): number {
  let cost = 0;
  order.forEach((slot, matchIndex) => {
    const match = matches[matchIndex];
    if (!match) return;
    for (const playerId of playersOf(match)) {
      cost += 2 * (usage.get(playerId)?.[slot] ?? 0) + 1;
    }
  });
  return cost;
}

function* permutations(values: readonly number[]): Generator<number[]> {
  if (values.length <= 1) {
    yield [...values];
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index] as number;
    const rest = values.filter((_, position) => position !== index);
    for (const tail of permutations(rest)) {
      yield [head, ...tail];
    }
  }
}

/** Полный перебор дешёвый до шести кортов (720 вариантов), дальше идём жадно. */
const EXHAUSTIVE_LIMIT = 6;

function bestOrder(
  matches: readonly CourtMatch[],
  slots: readonly number[],
  usage: CourtUsage,
): number[] {
  if (matches.length <= EXHAUSTIVE_LIMIT) {
    let best = [...slots];
    let bestCost = Number.POSITIVE_INFINITY;
    for (const order of permutations(slots)) {
      const cost = orderCost(matches, order, usage);
      if (cost < bestCost) {
        bestCost = cost;
        best = order;
      }
    }
    return best;
  }

  const free = new Set(slots);
  const order: number[] = [];
  for (const match of matches) {
    let bestSlot = [...free][0] as number;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const slot of free) {
      const cost = orderCost([match], [slot], usage);
      if (cost < bestCost) {
        bestCost = cost;
        bestSlot = slot;
      }
    }
    free.delete(bestSlot);
    order.push(bestSlot);
  }
  return order;
}

/** Корты идут по порядку: организатору так проще сверяться с площадкой. */
const byCourt = (left: MatchPlan, right: MatchPlan): number => left.court - right.court;

function withOrder(round: RoundPlan, order: readonly number[]): RoundPlan {
  const matches = round.matches
    .map((match, index) => ({ ...match, court: (order[index] ?? index) + 1 }))
    .sort(byCourt);
  return { ...round, matches };
}

/**
 * Ставит матчи одного раунда на корты с учётом того, кто где уже играл.
 * `usage` дополняется сыгранным, поэтому функцию можно вызывать по ходу турнира.
 */
export function assignRoundCourts(round: RoundPlan, courts: number, usage: CourtUsage): RoundPlan {
  if (round.matches.length === 0) return round;

  const slots = Array.from({ length: Math.min(round.matches.length, courts) }, (_, i) => i);
  const order = bestOrder(round.matches, slots, usage);
  round.matches.forEach((match, index) => {
    applyMatch(usage, match, order[index] ?? index, courts, 1);
  });
  return withOrder(round, order);
}

function cloneUsage(usage: CourtUsage): CourtUsage {
  return new Map([...usage].map(([id, row]) => [id, [...row]]));
}

/** Метрика качества: сначала худший перекос, потом сумма квадратов. */
function quality(usage: CourtUsage): [number, number] {
  let spread = 0;
  let squares = 0;
  for (const row of usage.values()) {
    spread = Math.max(spread, Math.max(...row) - Math.min(...row));
    for (const value of row) squares += value * value;
  }
  return [spread, squares];
}

const better = (left: [number, number], right: [number, number]): boolean =>
  left[0] < right[0] || (left[0] === right[0] && left[1] < right[1]);

/** Проходы локального поиска: каждый раунд вынимается и ставится заново. */
function refine(rounds: RoundPlan[], courts: number, usage: CourtUsage): void {
  for (let pass = 0; pass < 12; pass += 1) {
    let improved = false;

    for (let index = 0; index < rounds.length; index += 1) {
      const round = rounds[index] as RoundPlan;
      if (round.matches.length === 0) continue;

      const current = round.matches.map((match) => match.court - 1);
      for (const match of round.matches) {
        applyMatch(usage, match, match.court - 1, courts, -1);
      }

      const slots = Array.from({ length: Math.min(round.matches.length, courts) }, (_, i) => i);
      const order = bestOrder(round.matches, slots, usage);
      if (orderCost(round.matches, order, usage) < orderCost(round.matches, current, usage)) {
        improved = true;
      }

      round.matches.forEach((match, position) => {
        applyMatch(usage, match, order[position] ?? position, courts, 1);
      });
      rounds[index] = withOrder(round, order);
    }

    if (!improved) break;
  }
}

/**
 * Раскидывает по кортам всё расписание сразу.
 *
 * Один жадный проход застревает на плато: перестановка любого одного раунда
 * ничего не улучшает, хотя лучший расклад существует. Поэтому делаем несколько
 * попыток со случайного старта и оставляем самую ровную.
 *
 * `usage` — уже сыгранное (для турнира, который идёт); он не меняется.
 */
export function balanceScheduleCourts(
  rounds: readonly RoundPlan[],
  courts: number,
  usage: CourtUsage = new Map(),
  rng?: Rng,
): RoundPlan[] {
  const attempts = rng ? 24 : 1;
  let best: RoundPlan[] | null = null;
  let bestQuality: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptUsage = cloneUsage(usage);
    const candidate =
      attempt === 0
        ? rounds.map((round) => assignRoundCourts(round, courts, attemptUsage))
        : rounds.map((round) => randomAssignment(round, courts, attemptUsage, rng!));

    refine(candidate, courts, attemptUsage);

    const score = quality(attemptUsage);
    if (best === null || better(score, bestQuality)) {
      best = candidate;
      bestQuality = score;
      if (score[0] <= 1) break;
    }
  }

  return best ?? [...rounds];
}

function randomAssignment(
  round: RoundPlan,
  courts: number,
  usage: CourtUsage,
  rng: Rng,
): RoundPlan {
  const slots = rng.shuffle(
    Array.from({ length: Math.min(round.matches.length, courts) }, (_, i) => i),
  );
  round.matches.forEach((match, position) => {
    applyMatch(usage, match, slots[position] ?? position, courts, 1);
  });
  return withOrder(round, slots);
}

/**
 * Насколько ровно игроки распределены по кортам: 0 — идеально, больше — хуже.
 * Для каждого игрока берётся разница между самым частым и самым редким кортом,
 * результат — худший показатель по составу. Корты, на которых игрок не был ни
 * разу, тоже считаются: это и есть перекос.
 */
export function courtSpread(rounds: readonly RoundPlan[]): {
  maxSpread: number;
  perPlayer: CourtUsage;
} {
  const matches = rounds.flatMap((round) => round.matches);
  const courts = matches.reduce((max, match) => Math.max(max, match.court), 0);
  if (courts === 0) return { maxSpread: 0, perPlayer: new Map() };

  const usage = courtUsageFromMatches(matches, courts);
  let maxSpread = 0;
  for (const row of usage.values()) {
    maxSpread = Math.max(maxSpread, Math.max(...row) - Math.min(...row));
  }
  return { maxSpread, perPlayer: usage };
}
