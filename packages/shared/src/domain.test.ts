import { describe, expect, it } from 'vitest';
import { groupLinkedRoster, sortLinkedPairsBySeed } from './domain.js';

describe('groupLinkedRoster', () => {
  it('склеивает взаимные пары и оставляет остальных', () => {
    const a = { player: { id: 'a' }, partnerPlayerId: 'b' };
    const b = { player: { id: 'b' }, partnerPlayerId: 'a' };
    const c = { player: { id: 'c' }, partnerPlayerId: null };
    const d = { player: { id: 'd' }, partnerPlayerId: 'missing' };

    expect(groupLinkedRoster([a, b, c, d])).toEqual({
      pairs: [[a, b]],
      unpaired: [c, d],
    });
  });

  it('одностороннюю ссылку не считает парой', () => {
    const a = { player: { id: 'a' }, partnerPlayerId: 'b' };
    const b = { player: { id: 'b' }, partnerPlayerId: null };

    expect(groupLinkedRoster([a, b])).toEqual({
      pairs: [],
      unpaired: [a, b],
    });
  });
});

describe('sortLinkedPairsBySeed', () => {
  it('ставит сильнейшую пару первой', () => {
    const weak: [{ player: { id: string; doublesRating: number } }, { player: { id: string; doublesRating: number } }] = [
      { player: { id: 'w1', doublesRating: 2 } },
      { player: { id: 'w2', doublesRating: 2 } },
    ];
    const strong: [{ player: { id: string; doublesRating: number } }, { player: { id: string; doublesRating: number } }] = [
      { player: { id: 's1', doublesRating: 5 } },
      { player: { id: 's2', doublesRating: 4 } },
    ];
    const seeds = [
      { seed: 1, players: [{ id: 's1' }, { id: 's2' }] },
      { seed: 2, players: [{ id: 'w1' }, { id: 'w2' }] },
    ];
    expect(sortLinkedPairsBySeed([weak, strong], seeds).map((pair) => pair[0].player.id)).toEqual([
      's1',
      'w1',
    ]);
  });
});
