import { describe, expect, it } from 'vitest';
import type { Photo } from '../src/shared/types';
import { buildIndex, buildBuckets, countBetween, floorUnit, nextUnit, pickUnit, formatRange, buildTicks, DAY } from '../src/renderer/src/features/timeline/model';

const ph = (t: number, geo = true) => ({ sortTime: t, lat: geo ? 1 : null, lon: geo ? 1 : null }) as Photo;

describe('timeline model', () => {
  const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
  const photos = [ph(t(2024, 3, 5)), ph(t(2024, 3, 5)), ph(t(2024, 3, 20), false), ph(t(2024, 5, 1))].reverse();
  const ix = buildIndex(photos)!;

  it('indexes counts at day resolution', () => {
    expect(ix.count).toBe(4);
    expect(ix.geoTimes.length).toBe(3);
    expect(countBetween(ix, t(2024, 3, 1), t(2024, 3, 31))).toBe(3);
    expect(countBetween(ix, t(2024, 4, 1), t(2024, 4, 30))).toBe(0);
  });
  it('buckets by month and week (Monday based)', () => {
    const m = buildBuckets(ix, 'month', Date.UTC(2024, 2, 1), Date.UTC(2024, 5, 1));
    expect(m.map((b) => b.count)).toEqual([3, 0, 1]);
    expect(new Date(floorUnit(t(2024, 3, 6), 'week')).getUTCDay()).toBe(1);
    expect(nextUnit(Date.UTC(2024, 11, 1), 'month')).toBe(Date.UTC(2025, 0, 1));
  });
  it('picks units by density and formats aligned ranges', () => {
    expect(pickUnit(10)).toBe('day'); expect(pickUnit(1)).toBe('week'); expect(pickUnit(0.3)).toBe('month'); expect(pickUnit(0.02)).toBe('year');
    expect(formatRange(Date.UTC(2023, 0, 1), Date.UTC(2024, 0, 1) - 1, 'en-GB')).toBe('2023');
    expect(formatRange(Date.UTC(2023, 4, 1), Date.UTC(2023, 5, 1) - 1, 'en-GB')).toBe('May 2023');
  });
  it('produces labelled ticks', () => {
    const ticks = buildTicks(Date.UTC(2020, 0, 1), Date.UTC(2024, 0, 1), 1000, 'en-GB');
    expect(ticks.some((k) => k.label === '2022')).toBe(true);
    expect(buildTicks(0, 0, 100, 'en-GB')).toEqual([]);
    expect(DAY).toBe(864e5);
  });
});
