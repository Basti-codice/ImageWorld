import type { Photo } from '@shared/types';
import type { GroupBy } from './prefs';

/** One photo in a justified row. x is relative to the row's left edge. */
export interface GridItem { index: number; x: number; w: number }

export interface HeadingRow {
  kind: 'head';
  top: number;
  h: number;
  /** epoch ms of the first photo of the group */
  time: number;
  /** photo index range [from, to] (inclusive) of the group */
  from: number;
  to: number;
  count: number;
  /** most frequent place names (max 2–3) and how many further places exist */
  places: string[];
  morePlaces: number;
  first: boolean;
}

export interface PhotoRow {
  kind: 'row';
  top: number;
  /** full row height incl. trailing gap */
  h: number;
  /** image height */
  imgH: number;
  items: GridItem[];
  /** index of the first photo */
  first: number;
}

export type Row = HeadingRow | PhotoRow;

export interface Mark { top: number; time: number; year: number; month: number }

export interface GridLayout {
  rows: Row[];
  total: number;
  /** only the photo rows (ascending by first photo index) */
  photoRows: PhotoRow[];
  /** row indices of headings */
  headIdx: number[];
  /** one entry per calendar month present (scrubber) */
  marks: Mark[];
}

export interface LayoutOpts {
  width: number;
  rowHeight: number;
  gap: number;
  grouped: boolean;
  groupBy: GroupBy;
}

export const HEADING_H = 56;
export const HEADING_H_FIRST = 44;
const DAY = 864e5;

const clampAr = (p: Photo) => {
  const ar = p.width > 0 && p.height > 0 ? p.width / p.height : 1.5;
  return ar < 0.5 ? 0.5 : ar > 3 ? 3 : ar;
};

/** Greedy justified layout of photos[a..b) into rows; appends to `rows`, returns new top. */
function justify(photos: Photo[], a: number, b: number, o: LayoutOpts, top: number, rows: Row[], photoRows: PhotoRow[]): number {
  const { width: W, rowHeight: target, gap } = o;
  let i = a;
  while (i < b) {
    let sum = 0;
    let end = b;
    let h = target;
    let filled = false;
    for (let j = i; j < b; j++) {
      sum += clampAr(photos[j]);
      const n = j - i + 1;
      const hj = (W - gap * (n - 1)) / sum;
      if (hj <= target) {
        if (n > 1) {
          const hPrev = (W - gap * (n - 2)) / (sum - clampAr(photos[j]));
          if (Math.abs(hPrev - target) < Math.abs(hj - target)) { end = j; h = hPrev; filled = true; break; }
        }
        end = j + 1; h = hj; filled = true; break;
      }
    }
    if (!filled) {
      // last (short) row: keep target height, don't stretch
      end = b; h = target;
    }
    const imgH = Math.max(24, Math.floor(h));
    const items: GridItem[] = [];
    let x = 0;
    for (let k = i; k < end; k++) {
      const last = k === end - 1;
      let w = Math.round(clampAr(photos[k]) * imgH);
      if (filled && last) w = Math.max(8, W - x); // absorb rounding so the row ends exactly at the right edge
      items.push({ index: k, x, w });
      x += w + gap;
    }
    const row: PhotoRow = { kind: 'row', top, h: imgH + gap, imgH, items, first: i };
    rows.push(row); photoRows.push(row);
    top += row.h;
    i = end;
  }
  return top;
}

export function computeLayout(photos: Photo[], o: LayoutOpts): GridLayout {
  const rows: Row[] = [];
  const photoRows: PhotoRow[] = [];
  const headIdx: number[] = [];
  const marks: Mark[] = [];
  const n = photos.length;
  if (!n || o.width <= 0) return { rows, total: 0, photoRows, headIdx, marks };

  if (!o.grouped) {
    const total = justify(photos, 0, n, o, 0, rows, photoRows);
    return { rows, total, photoRows, headIdx, marks };
  }

  const month = o.groupBy === 'month';
  const keyOf = (t: number) => {
    if (!month) return Math.floor(t / DAY);
    const d = new Date(t);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const placeCounts = new Map<string, number>();
  let top = 0;
  let a = 0;
  let key = keyOf(photos[0].sortTime);
  let lastMarkKey = -1;
  const flush = (to: number) => {
    // heading for photos[a..to)
    const sorted = [...placeCounts.entries()].sort((x, y) => y[1] - x[1]);
    const keep = month ? 3 : 2;
    const head: HeadingRow = {
      kind: 'head', top, h: a === 0 ? HEADING_H_FIRST : HEADING_H, time: photos[a].sortTime, from: a, to: to - 1, count: to - a,
      places: sorted.slice(0, keep).map((e) => e[0]), morePlaces: Math.max(0, sorted.length - keep), first: a === 0,
    };
    headIdx.push(rows.length);
    rows.push(head);
    const d = new Date(head.time);
    const mk = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (mk !== lastMarkKey) { marks.push({ top, time: head.time, year: d.getUTCFullYear(), month: d.getUTCMonth() }); lastMarkKey = mk; }
    top += head.h;
    top = justify(photos, a, to, o, top, rows, photoRows);
    placeCounts.clear();
  };
  for (let i = 0; i < n; i++) {
    const p = photos[i];
    const k = keyOf(p.sortTime);
    if (k !== key) { flush(i); a = i; key = k; }
    const c = p.place?.city;
    if (c) placeCounts.set(c, (placeCounts.get(c) ?? 0) + 1);
  }
  flush(n);
  return { rows, total: top, photoRows, headIdx, marks };
}

/** index of the photo row containing photo `index` (binary search) */
export function rowOfIndex(photoRows: PhotoRow[], index: number): number {
  let lo = 0, hi = photoRows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (photoRows[mid].first <= index) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** first row index whose bottom edge is below y (rows are sorted by top) */
export function firstRowAtOrBelow(rows: Row[], y: number): number {
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].h <= y) lo = mid + 1; else hi = mid;
  }
  return lo;
}
