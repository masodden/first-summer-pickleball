import type { Rng } from './rng.js';
import type { SeatRound } from './pairings.js';
import type { EnginePlayer, MatchPlan } from './types.js';

/** Игрокам без рейтинга подставляется медиана состава, иначе балансировка ломается. */
export function medianRating(players: readonly EnginePlayer[]): number {
  const values = players
    .map((player) => player.rating)
    .filter((rating): rating is number => rating !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) return 4;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] as number;
  return ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

export function buildRatingLookup(players: readonly EnginePlayer[]): {
  get(id: string): number;
  median: number;
} {
  const median = medianRating(players);
  const map = new Map<string, number>();
  for (const player of players) {
    map.set(player.id, player.rating ?? median);
  }
  return { get: (id) => map.get(id) ?? median, median };
}

export function matchImbalance(match: MatchPlan, rating: (id: string) => number): number {
  const sumA = rating(match.teamA[0]) + rating(match.teamA[1]);
  const sumB = rating(match.teamB[0]) + rating(match.teamB[1]);
  return Math.abs(sumA - sumB);
}

function seatingCost(
  rounds: readonly SeatRound[],
  seating: readonly string[],
  rating: (id: string) => number,
): number {
  let total = 0;
  for (const round of rounds) {
    for (const match of round.matches) {
      const sumA =
        rating(seating[match.teamA[0]] as string) + rating(seating[match.teamA[1]] as string);
      const sumB =
        rating(seating[match.teamB[0]] as string) + rating(seating[match.teamB[1]] as string);
      total += Math.abs(sumA - sumB);
    }
  }
  return total;
}

/**
 * Подбирает, кто из игроков займёт какое место в готовом расписании.
 * Комбинаторные свойства americano не зависят от этой подстановки, поэтому
 * перемешивание безопасно: меняются только конкретные пары на кортах.
 */
export function optimizeSeating(
  rounds: readonly SeatRound[],
  players: readonly EnginePlayer[],
  rng: Rng,
  options: { ratingBalance: boolean; iterations?: number } = { ratingBalance: true },
): string[] {
  const ids = players.map((player) => player.id);
  if (!options.ratingBalance) {
    return rng.shuffle(ids);
  }

  const { get: rating } = buildRatingLookup(players);
  const iterations = options.iterations ?? 4000;

  let best = rng.shuffle(ids);
  let bestCost = seatingCost(rounds, best, rating);

  let current = [...best];
  let currentCost = bestCost;

  for (let step = 0; step < iterations; step += 1) {
    const i = rng.int(current.length);
    let j = rng.int(current.length);
    if (i === j) j = (j + 1) % current.length;

    const candidate = [...current];
    const a = candidate[i] as string;
    const b = candidate[j] as string;
    candidate[i] = b;
    candidate[j] = a;

    const cost = seatingCost(rounds, candidate, rating);
    if (cost <= currentCost) {
      current = candidate;
      currentCost = cost;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    if (bestCost === 0) break;
  }

  return best;
}
