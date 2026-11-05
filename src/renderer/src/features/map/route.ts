export type LL = [number, number];

/** Drops points closer than `eps` degrees (Chebyshev) to the previously kept one; the last point is always kept. */
export function collapseRoute(pts: LL[], eps: number): LL[] {
  if (pts.length < 3) return pts.slice();
  const out: LL[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.abs(pts[i][0] - l[0]) >= eps || Math.abs(pts[i][1] - l[1]) >= eps) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const RAD = Math.PI / 180;

/** Intermediate great-circle vertices from a to b (b included, a excluded). Longitudes are unwrapped relative to `a`. */
function greatCircle(a: LL, b: LL, stepDeg: number): LL[] {
  let dl = b[0] - a[0];
  while (dl > 180) dl -= 360;
  while (dl < -180) dl += 360;
  const end: LL = [a[0] + dl, b[1]];
  const φ1 = a[1] * RAD, φ2 = b[1] * RAD, λ1 = a[0] * RAD, λ2 = end[0] * RAD;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  const steps = Math.min(64, Math.floor(d / RAD / stepDeg));
  if (steps < 2 || !isFinite(d) || d < 1e-9) return [end];
  const out: LL[] = [];
  for (let i = 1; i < steps; i++) {
    const f = i / steps, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    let lon = Math.atan2(y, x) / RAD;
    // keep continuity with the previous vertex
    const prev = out.length ? out[out.length - 1][0] : a[0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  out.push(end);
  return out;
}

export interface Route {
  /** vertices (longitudes unwrapped so lines never jump across the map) */
  coords: LL[];
  /** timestamp per vertex, non-decreasing */
  t: number[];
}

/** Builds a smooth chronological route. `pts`/`times` must be sorted by time ASC. */
export function makeRoute(pts: LL[], times: number[], span: number): Route {
  let eps = Math.max(0.0005, span / 700);
  let kept: number[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    kept = [];
    let last: LL | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!last || Math.abs(p[0] - last[0]) >= eps || Math.abs(p[1] - last[1]) >= eps || i === pts.length - 1) { kept.push(i); last = p; }
    }
    if (kept.length <= 2500) break;
    eps *= 2;
  }
  const coords: LL[] = [];
  const t: number[] = [];
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k], p = pts[i];
    if (k === 0) { coords.push([p[0], p[1]]); t.push(times[i]); continue; }
    const prev = coords[coords.length - 1], t0 = t[t.length - 1], t1 = times[i];
    const seg = greatCircle(prev, p, 4);
    seg.forEach((q, j) => { coords.push(q); t.push(t0 + ((t1 - t0) * (j + 1)) / seg.length); });
  }
  return { coords, t };
}

/** Route polyline up to `cursor` including an interpolated head. */
export function routeUntil(r: Route, cursor: number): LL[] {
  const { t, coords } = r;
  if (!coords.length || cursor < t[0]) return [];
  if (cursor >= t[t.length - 1]) return coords;
  let lo = 0, hi = t.length - 1; // last index with t <= cursor
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t[m] <= cursor) lo = m; else hi = m - 1; }
  const out = coords.slice(0, lo + 1);
  const a = coords[lo], b = coords[lo + 1], f = t[lo + 1] > t[lo] ? (cursor - t[lo]) / (t[lo + 1] - t[lo]) : 0;
  out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  return out;
}
