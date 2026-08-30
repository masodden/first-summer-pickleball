import { describe, expect, it } from 'vitest';
import { groupLinkedRoster } from './domain.js';

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
