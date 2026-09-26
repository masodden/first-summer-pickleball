import { describe, expect, it } from 'vitest';
import { rewritePlayerTokens } from './players.js';

describe('rewritePlayerTokens', () => {
  it('переписывает ключ пары и сохраняет канонический порядок', () => {
    expect(rewritePlayerTokens('ZZZZZZ|AAAAAA', 'AAAAAA', 'MMMMMM')).toBe('MMMMMM|ZZZZZZ');
  });

  it('переписывает слот группы, не трогая соседнюю пару', () => {
    expect(rewritePlayerTokens('G1:AAAAAA|BBBBBB:CCCCCC|DDDDDD', 'AAAAAA', 'MMMMMM')).toBe(
      'G1:BBBBBB|MMMMMM:CCCCCC|DDDDDD',
    );
  });

  it('не меняет слот плей-офф и чужие id', () => {
    expect(rewritePlayerTokens('final', 'AAAAAA', 'MMMMMM')).toBe('final');
    expect(rewritePlayerTokens('G1:BBBBBB|CCCCCC:DDDDDD|EEEEEE', 'AAAAAA', 'MMMMMM')).toBe(
      'G1:BBBBBB|CCCCCC:DDDDDD|EEEEEE',
    );
  });
});
