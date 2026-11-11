import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { dateStamp, stampDate } from './dates.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dateStamp', () => {
  it('stamps a date in local time with its offset either side of UTC, and reads back', () => {
    const date = new Date(2026, 10, 2, 9, 5, 7);
    for (const [minutes, zone] of [
      [240, '-0400'],
      [-330, '+0530'],
    ] as const) {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(minutes);
      expect(dateStamp(date)).toBe(`2026-11-02 09:05:07 ${zone}`);
    }
    expect(stampDate(dateStamp(date))).toEqual(date);
  });
});
