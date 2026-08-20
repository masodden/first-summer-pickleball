import { describe, expect, it } from 'vitest';
import { tabDirection } from './tab-view-transition';

describe('tabDirection', () => {
  it('считает тренировки отдельным табом сразу после турниров', () => {
    expect(tabDirection('/tournaments', '/trainings')).toBe('forward');
    expect(tabDirection('/trainings', '/tournaments')).toBe('back');
  });

  it('ведёт вперёд от тренировок к «Об игре» и к игрокам', () => {
    expect(tabDirection('/trainings', '/about')).toBe('forward');
    expect(tabDirection('/trainings', '/players')).toBe('forward');
    expect(tabDirection('/about', '/trainings')).toBe('back');
  });

  it('не анимирует переход внутри одного таба', () => {
    expect(tabDirection('/trainings', '/trainings/new')).toBeNull();
    expect(tabDirection('/tournaments', '/tournaments/abc/info')).toBeNull();
  });
});
