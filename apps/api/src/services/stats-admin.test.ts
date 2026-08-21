import { describe, expect, it } from 'vitest';
import { adminStatsWindows, moscowDayStartDaysAgo, startOfMoscowDay } from './stats-admin';

describe('adminStatsWindows', () => {
  it('сегодня начинается в полночь Москвы, а не UTC', () => {
    // 21 августа 2026, 00:30 МСК = 20 августа 21:30 UTC.
    const now = new Date('2026-08-20T21:30:00.000Z');
    const { todayStart, weekStart, monthStart } = adminStatsWindows(now);

    expect(todayStart.toISOString()).toBe('2026-08-20T21:00:00.000Z');
    expect(weekStart.toISOString()).toBe('2026-08-14T21:00:00.000Z');
    expect(monthStart.toISOString()).toBe('2026-07-22T21:00:00.000Z');
  });

  it('за секунду до полуночи Москвы день ещё вчерашний', () => {
    const beforeMidnight = new Date('2026-08-20T20:59:59.000Z');
    expect(startOfMoscowDay(beforeMidnight).toISOString()).toBe('2026-08-19T21:00:00.000Z');

    const atMidnight = new Date('2026-08-20T21:00:00.000Z');
    expect(startOfMoscowDay(atMidnight).toISOString()).toBe('2026-08-20T21:00:00.000Z');
  });

  it('неделя — 7 календарных дней включая сегодня', () => {
    const now = new Date('2026-08-21T12:00:00+03:00');
    expect(moscowDayStartDaysAgo(now, 0).toISOString()).toBe(startOfMoscowDay(now).toISOString());
    expect(moscowDayStartDaysAgo(now, 6).toISOString()).toBe('2026-08-14T21:00:00.000Z');
  });
});
