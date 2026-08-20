import { describe, expect, it } from 'vitest';
import { pickAppHeight } from './telegram-viewport';

describe('pickAppHeight', () => {
  it('берёт стабильную высоту Telegram, если она есть', () => {
    expect(
      pickAppHeight({
        stableHeight: 720,
        viewportHeight: 680,
        visualHeight: 740,
        innerHeight: 800,
      }),
    ).toBe(720);
  });

  it('пропускает нули и невалидные значения', () => {
    expect(
      pickAppHeight({
        stableHeight: 0,
        viewportHeight: Number.NaN,
        visualHeight: 640.4,
        innerHeight: 900,
      }),
    ).toBe(640);
  });

  it('в обычном браузере падает на visualViewport, затем innerHeight', () => {
    expect(pickAppHeight({ visualHeight: 812, innerHeight: 900 })).toBe(812);
    expect(pickAppHeight({ innerHeight: 900 })).toBe(900);
  });
});
