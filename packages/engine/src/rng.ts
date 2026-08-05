/**
 * Детерминированный генератор: один и тот же seed даёт одно и то же расписание.
 * Это важно и для тестов, и для того, чтобы reshuffle можно было воспроизвести.
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed = 1): Rng {
  let state = seed >>> 0 || 1;

  const next = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.min(maxExclusive - 1, Math.floor(next() * maxExclusive));
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      const a = copy[i] as T;
      const b = copy[j] as T;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  };

  return { next, int, shuffle };
}
