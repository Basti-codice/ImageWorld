import type { Photo } from '@shared/types';

/**
 * Fast screen-space grid clustering over typed arrays.
 * `photos` must be sorted newest first (useDerived().geo is) – the smallest index of a group is therefore its newest photo.
 */
export class PhotoIndex {
  readonly n: number;
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly mx: Float64Array;
  readonly my: Float64Array;
  readonly time: Float64Array;
  readonly fav: Uint8Array;

  constructor(readonly photos: Photo[]) {
    const n = (this.n = photos.length);
    this.lon = new Float64Array(n); this.lat = new Float64Array(n);
    this.mx = new Float64Array(n); this.my = new Float64Array(n);
    this.time = new Float64Array(n); this.fav = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = photos[i];
      const lo = p.lon as number, la = p.lat as number;
      this.lon[i] = lo; this.lat[i] = la;
      this.mx[i] = (lo + 180) / 360;
      const c = Math.max(-85.0511, Math.min(85.0511, la)) * Math.PI / 180;
      this.my[i] = 0.5 - Math.log(Math.tan(Math.PI / 4 + c / 2)) / (2 * Math.PI);
      this.time[i] = p.sortTime; this.fav[i] = p.favorite ? 1 : 0;
    }
  }

  /** first index whose sortTime <= t (array is sorted DESC); n if none */
  firstAtOrBefore(t: number): number {
    let lo = 0, hi = this.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.time[mid] <= t) hi = mid; else lo = mid + 1; }
    return lo;
  }

  /** indices of photos within a lon/lat box (optionally from `start`) */
  inBox(w: number, s: number, e: number, n: number, start = 0): number[] {
    const out: number[] = [];
    for (let i = start; i < this.n; i++) { const lo = this.lon[i], la = this.lat[i]; if (lo >= w && lo <= e && la >= s && la <= n) out.push(i); }
    return out;
  }
}

export interface Cluster {
  key: string;
  lon: number; lat: number;
  count: number;
  /** representative photo (favourite first, else newest) – index into PhotoIndex.photos */
  rep: number;
  /** newest member */
  newest: number;
  /** [w,s,e,n] of members */
  bbox: [number, number, number, number];
}

export interface ClusterOptions {
  /** integer zoom level the grid is built for */
  zoom: number;
  /** grid cell size in px */
  cellPx: number;
  /** merge clusters whose centres are closer than this many px */
  minDistPx: number;
  /** [w,s,e,n] cull box (already padded) or null for none */
  bounds: [number, number, number, number] | null;
  start?: number;
}

const unMercY = (my: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;

interface Acc { cx: number; cy: number; sx: number; sy: number; n: number; fav: number; any: number; w: number; s: number; e: number; nn: number }

export function clusterize(ix: PhotoIndex, o: ClusterOptions): Cluster[] {
  const world = 512 * 2 ** o.zoom;
  const cell = o.cellPx / world;
  const b = o.bounds;
  const cells = new Map<number, Acc>();
  const { lon, lat, mx, my, fav, n } = ix;
  const wrapX = !b || b[2] - b[0] >= 360;
  for (let i = o.start ?? 0; i < n; i++) {
    const lo = lon[i], la = lat[i];
    if (b && ((!wrapX && (lo < b[0] || lo > b[2])) || la < b[1] || la > b[3])) continue;
    const cx = Math.floor(mx[i] / cell), cy = Math.floor(my[i] / cell);
    const k = cx * 4194304 + cy;
    let a = cells.get(k);
    if (!a) { a = { cx, cy, sx: 0, sy: 0, n: 0, fav: -1, any: i, w: lo, s: la, e: lo, nn: la }; cells.set(k, a); }
    a.sx += mx[i]; a.sy += my[i]; a.n++;
    if (fav[i] && a.fav < 0) a.fav = i;
    if (lo < a.w) a.w = lo; if (lo > a.e) a.e = lo; if (la < a.s) a.s = la; if (la > a.nn) a.nn = la;
  }
  let list: Array<Cluster & { px: number; py: number }> = [];
  for (const a of cells.values()) {
    const x = a.sx / a.n, y = a.sy / a.n;
    list.push({
      key: `${o.zoom}:${a.cx}:${a.cy}`, lon: x * 360 - 180, lat: unMercY(y), count: a.n, rep: a.fav >= 0 ? a.fav : a.any, newest: a.any,
      bbox: [a.w, a.s, a.e, a.nn], px: x * world, py: y * world,
    });
  }
  // greedy de-overlap: big clusters absorb close neighbours
  if (o.minDistPx > 0 && list.length > 1) {
    list.sort((p, q) => q.count - p.count);
    const d2 = o.minDistPx * o.minDistPx;
    const out: typeof list = [];
    const dead = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) {
      if (dead[i]) continue;
      const c = list[i];
      let sx = c.px * c.count, sy = c.py * c.count;
      for (let j = i + 1; j < list.length; j++) {
        if (dead[j]) continue;
        const m = list[j];
        const dx = m.px - c.px, dy = m.py - c.py;
        if (dx * dx + dy * dy < d2) {
          dead[j] = 1;
          sx += m.px * m.count; sy += m.py * m.count;
          c.count += m.count;
          c.newest = Math.min(c.newest, m.newest);
          // rep: favourite beats non-favourite, then newer
          const cf = fav[c.rep], mf = fav[m.rep];
          if (mf > cf || (mf === cf && m.rep < c.rep)) c.rep = m.rep;
          if (m.bbox[0] < c.bbox[0]) c.bbox[0] = m.bbox[0]; if (m.bbox[1] < c.bbox[1]) c.bbox[1] = m.bbox[1];
          if (m.bbox[2] > c.bbox[2]) c.bbox[2] = m.bbox[2]; if (m.bbox[3] > c.bbox[3]) c.bbox[3] = m.bbox[3];
        }
      }
      if (c.count > 0) { c.px = sx / c.count; c.py = sy / c.count; c.lon = (c.px / world) * 360 - 180; c.lat = unMercY(c.py / world); }
      out.push(c);
    }
    list = out;
  }
  return list;
}

/** great-circle angular distance in degrees */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon1 - lon2) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}
