import type { MatchPlan } from './types.js';

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Считает, кто с кем уже играл в паре и против кого выходил.
 * На этом строится вся оценка качества расписания.
 */
export class PairHistory {
  private readonly partners = new Map<string, number>();
  private readonly opponents = new Map<string, number>();
  private readonly games = new Map<string, number>();

  partnerCount(a: string, b: string): number {
    return this.partners.get(pairKey(a, b)) ?? 0;
  }

  opponentCount(a: string, b: string): number {
    return this.opponents.get(pairKey(a, b)) ?? 0;
  }

  gamesPlayed(id: string): number {
    return this.games.get(id) ?? 0;
  }

  setGamesPlayed(id: string, value: number): void {
    this.games.set(id, value);
  }

  registerMatch(match: MatchPlan): void {
    const [a1, a2] = match.teamA;
    const [b1, b2] = match.teamB;
    this.bump(this.partners, pairKey(a1, a2));
    this.bump(this.partners, pairKey(b1, b2));
    for (const a of match.teamA) {
      for (const b of match.teamB) {
        this.bump(this.opponents, pairKey(a, b));
      }
    }
    for (const id of [a1, a2, b1, b2]) {
      this.bump(this.games, id);
    }
  }

  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}
