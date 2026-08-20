import { describe, expect, it } from 'vitest';
import { classifyNav } from './motion';

describe('classifyNav', () => {
  it('между турнирами и тренировками делает свайп таба, а не внутренний слайд', () => {
    expect(classifyNav('/tournaments', '/trainings')).toBe('tab');
    expect(classifyNav('/trainings', '/tournaments')).toBe('tab');
  });

  it('внутри карточки тренировки слайдит вкладки info/players', () => {
    expect(classifyNav('/trainings/abc/info', '/trainings/abc/players')).toBe('inner-forward');
    expect(classifyNav('/trainings/abc/players', '/trainings/abc/info')).toBe('inner-back');
  });
});
