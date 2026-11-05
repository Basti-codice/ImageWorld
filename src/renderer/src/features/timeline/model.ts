/**
 * Pure timeline maths: day index (prefix sums), buckets per zoom level, axis ticks, presets, range formatting.
 * No React, no stores – everything here is computed once per filter change and never per frame.
 */
import type { Photo } from '@shared/types';

export const DAY = 864e5;
export type Unit = 'day' | 'week' | 'month' | 'year';
export type Range = [number, number];

/* ----------------------------------------------------------------- index */

export interface TimeIndex {
  count: number;
  /** earliest / latest photo (ms) */
  first: number;
  last: number;
  /** all sort times ascending */
  times: Float64Array;
  /** ascending times of geotagged photos only (journey playback) */
  geoTimes: Float64Array;
  minDay: number;
  /** prefix[i] = number of photos with day < minDay + i */
  prefix: Uint32Array;
}

const MAX_DAYS = 40000;

/** O(n) – call once per `filteredNoRange` change. */
export function buildIndex(photos: Photo[]): TimeIndex | null {
  const n = photos.length;
  if (!n) return null;
  const times = new Float64Array(n);
  let geoN = 0, sorted = true;
  for (let i = 0; i < n; i++) {
    const p = photos[i];
    times[i] = p.sortTime;
    if (p.lat != null && p.lon != null) geoN++;
    if (i && times[i] < times[i - 1]) sorted = false;
  }
  if (!sorted) times.sort(); // `photos` normally arrives newest-first → typed-array sort is a fast O(n log n) fix-up
  const geoTimes = new Float64Array(geoN);
  let g = 0;
  for (let i = 0; i < n; i++) { const p = photos[i]; if (p.lat != null && p.lon != null) geoTimes[g++] = p.sortTime; }
  if (!isAscending(geoTimes)) geoTimes.sort();

  const first = times[0], last = times[n - 1];
  const maxDay = Math.floor(last / DAY);
  const minDay = Math.max(Math.floor(first / DAY), maxDay - MAX_DAYS);
  const days = maxDay - minDay + 1;
  const prefix = new Uint32Array(days + 1);
  for (let i = 0; i < n; i++) prefix[Math.max(0, Math.floor(times[i] / DAY) - minDay) + 1]++;
  for (let i = 1; i <= days; i++) prefix[i] += prefix[i - 1];
  return { count: n, first, last, times, geoTimes, minDay, prefix };
}

function isAscending(a: Float64Array) { for (let i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false; return true; }

/** photos with t0 <= time <= t1 at day resolution */
export function countBetween(ix: TimeIndex, t0: number, t1: number): number {
  const nDays = ix.prefix.length - 1;
  const a = Math.max(0, Math.floor(t0 / DAY) - ix.minDay);
  const b = Math.min(nDays - 1, Math.floor(t1 / DAY) - ix.minDay);
  return b < a ? 0 : ix.prefix[b + 1] - ix.prefix[a];
}

export function lowerBound(a: Float64Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
export function upperBound(a: Float64Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

/* ----------------------------------------------------------------- units */

export function floorUnit(t: number, u: Unit): number {
  switch (u) {
    case 'day': return Math.floor(t / DAY) * DAY;
    case 'week': { const d = Math.floor(t / DAY); const off = (((d + 3) % 7) + 7) % 7; return (d - off) * DAY; } // Monday
    case 'month': { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
    case 'year': return Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
  }
}
export function nextUnit(start: number, u: Unit): number {
  switch (u) {
    case 'day': return start + DAY;
    case 'week': return start + 7 * DAY;
    case 'month': { const d = new Date(start); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    case 'year': return Date.UTC(new Date(start).getUTCFullYear() + 1, 0, 1);
  }
}
/** last ms of the bucket that contains t */
export const endOfUnit = (t: number, u: Unit) => nextUnit(floorUnit(t, u), u) - 1;

/** bucket granularity from pixels per day, so bars stay >= ~4 px wide */
export function pickUnit(ppd: number): Unit {
  if (ppd >= 5) return 'day';
  if (ppd * 7 >= 5) return 'week';
  if (ppd * 30 >= 3.4) return 'month';
  return 'year';
}

export interface Bucket { start: number; end: number; count: number }

export function buildBuckets(ix: TimeIndex, unit: Unit, from: number, to: number): Bucket[] {
  const out: Bucket[] = [];
  let s = floorUnit(from, unit);
  for (let guard = 0; s < to && guard < 6000; guard++) {
    const e = nextUnit(s, unit);
    out.push({ start: s, end: e, count: countBetween(ix, s, e - 1) });
    s = e;
  }
  return out;
}

/* ----------------------------------------------------------------- ticks */

export interface Tick { t: number; label: string; major: boolean }

export function buildTicks(from: number, to: number, width: number, locale: string): Tick[] {
  const span = to - from;
  if (span <= 0 || width <= 0) return [];
  const ppd = width / (span / DAY);
  const mon = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' });
  const out: Tick[] = [];
  const clean = (s: string) => s.replace(/\.$/, '');
  const dayNum = (t: number) => new Date(t).getUTCDate();

  if (ppd >= 22) {
    for (let t = floorUnit(from, 'day'); t <= to; t += DAY) {
      const d = new Date(t); const first = d.getUTCDate() === 1;
      out.push({ t, label: first ? `${clean(mon.format(t))}${d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ''}` : String(dayNum(t)), major: first });
    }
  } else if (ppd >= 7.5) {
    for (let t = floorUnit(from, 'week'); t <= to; t += 7 * DAY) out.push({ t, label: `${dayNum(t)}. ${clean(mon.format(t))}`, major: dayNum(t) <= 7 });
  } else if (ppd >= 1.15) {
    for (let t = floorUnit(from, 'month'); t <= to; t = nextUnit(t, 'month')) {
      const m = new Date(t).getUTCMonth();
      out.push({ t, label: m === 0 ? String(new Date(t).getUTCFullYear()) : clean(mon.format(t)), major: m === 0 });
    }
  } else if (ppd >= 0.4) {
    for (let t = floorUnit(from, 'month'); t <= to; t = nextUnit(t, 'month')) {
      const m = new Date(t).getUTCMonth();
      if (m % 3) continue;
      out.push({ t, label: m === 0 ? String(new Date(t).getUTCFullYear()) : clean(mon.format(t)), major: m === 0 });
    }
  } else {
    const step = [1, 2, 5, 10, 20, 50, 100].find((s) => s * 365.25 * ppd >= 44) ?? 100;
    const y0 = new Date(from).getUTCFullYear();
    for (let y = Math.floor(y0 / step) * step; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > to) break;
      out.push({ t, label: String(y), major: true });
    }
  }
  return out;
}

/* --------------------------------------------------------------- presets */

export type PresetId = 'all' | 'thisYear' | 'lastYear' | 'last30';
export interface Preset { id: PresetId; range: Range | null }

/** `now` is local-as-UTC (photo times are stored that way) */
export function presets(now: number): Preset[] {
  const y = new Date(now).getUTCFullYear();
  const today = Math.floor(now / DAY) * DAY;
  return [
    { id: 'all', range: null },
    { id: 'thisYear', range: [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1) - 1] },
    { id: 'lastYear', range: [Date.UTC(y - 1, 0, 1), Date.UTC(y, 0, 1) - 1] },
    { id: 'last30', range: [today - 29 * DAY, today + DAY - 1] },
  ];
}
export const localNowAsUtc = () => Date.now() - new Date().getTimezoneOffset() * 60000;
export const sameRange = (a: Range | null, b: Range | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);

/* ------------------------------------------------------------ formatting */

const aligned = (from: number, to: number, u: 'month' | 'year') => floorUnit(from, u) === from && floorUnit(to + 1, u) === to + 1;

export function formatRange(from: number, to: number, locale: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o });
  if (aligned(from, to, 'year')) {
    const y0 = new Date(from).getUTCFullYear(), y1 = new Date(to).getUTCFullYear();
    return y0 === y1 ? String(y0) : `${y0} – ${y1}`;
  }
  if (aligned(from, to, 'month')) {
    const same = floorUnit(from, 'month') === floorUnit(to, 'month');
    return same ? f({ month: 'long', year: 'numeric' }).format(from) : f({ month: 'short', year: 'numeric' }).formatRange(from, to);
  }
  if (Math.floor(from / DAY) === Math.floor(to / DAY)) return f({ day: 'numeric', month: 'long', year: 'numeric' }).format(from);
  return f({ day: 'numeric', month: 'short', year: 'numeric' }).formatRange(from, to);
}

export function formatBucket(b: Bucket, unit: Unit, locale: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o });
  switch (unit) {
    case 'day': return f({ day: 'numeric', month: 'long', year: 'numeric' }).format(b.start);
    case 'week': return f({ day: 'numeric', month: 'short', year: 'numeric' }).formatRange(b.start, b.end - 1);
    case 'month': return f({ month: 'long', year: 'numeric' }).format(b.start);
    case 'year': return f({ year: 'numeric' }).format(b.start);
  }
}

/* ----------------------------------------------------------------- views */

/** initial visible window: whole library, but ignoring a handful of bogus far-away dates (e.g. 1970 fallbacks) */
export function fitView(ix: TimeIndex): Range {
  let a = ix.first;
  const b = ix.last;
  const q = ix.times[Math.floor(ix.times.length * 0.005)];
  if (q - a > 365 * DAY && q - a > 0.25 * (b - q)) a = q;
  const pad = Math.max((b - a) * 0.02, 2 * DAY);
  let from = a - pad, to = b + pad;
  if (to - from < 21 * DAY) { const c = (from + to) / 2; from = c - 10.5 * DAY; to = c + 10.5 * DAY; }
  return [from, to];
}
export function viewLimits(ix: TimeIndex): Range {
  const pad = Math.max((ix.last - ix.first) * 0.02, 2 * DAY);
  let from = ix.first - pad, to = ix.last + pad;
  if (to - from < 21 * DAY) { const c = (from + to) / 2; from = c - 10.5 * DAY; to = c + 10.5 * DAY; }
  return [from, to];
}
export const MIN_SPAN = 3 * DAY;

export function clampView(v: Range, lim: Range): Range {
  const max = lim[1] - lim[0];
  let span = Math.min(Math.max(v[1] - v[0], MIN_SPAN), max);
  let from = v[0];
  if (from < lim[0]) from = lim[0];
  if (from + span > lim[1]) from = lim[1] - span;
  span = Math.max(span, MIN_SPAN);
  return [from, from + span];
}
