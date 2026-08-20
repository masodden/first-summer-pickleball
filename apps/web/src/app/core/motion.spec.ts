import { describe, expect, it } from 'vitest';
import { classifyNav, mainScrollBehavior } from './motion';

describe('classifyNav', () => {
  it('между турнирами и тренировками делает свайп таба, а не внутренний слайд', () => {
    expect(classifyNav('/tournaments', '/trainings')).toBe('tab');
    expect(classifyNav('/trainings', '/tournaments')).toBe('tab');
  });

  it('внутри карточки тренировки слайдит вкладки info/players', () => {
    expect(classifyNav('/trainings/abc/info', '/trainings/abc/players')).toBe('inner-forward');
    expect(classifyNav('/trainings/abc/players', '/trainings/abc/info')).toBe('inner-back');
  });

  it('не сбрасывает скролл на внутренних вкладках и восстанавливает его при pop', () => {
    expect(mainScrollBehavior('/tournaments/abc/info', '/tournaments/abc/players')).toBe('keep');
    expect(mainScrollBehavior('/tournaments/abc/info', '/tournaments')).toBe('restore');
    expect(mainScrollBehavior('/tournaments', '/tournaments/abc/info')).toBe('top');
    expect(mainScrollBehavior('/tournaments', '/settings')).toBe('top');
  });
});
