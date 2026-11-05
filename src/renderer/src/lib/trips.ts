/**
 * Trip / event detection on geotagged photos (pure, no UI imports – unit tested in tests/trips.test.ts).
 *
 *  1. Photos with coordinates are sorted by time (single sort, typed arrays afterwards – O(n log n) total).
 *  2. The "home" region is inferred: the 1° grid cell that is visited in the most distinct months (tie: most days).
 *     Vacations are dense in few months, home is spread over many – so months beat raw photo counts.
 *  3. The timeline is cut into segments on time gaps (> 36 h; 12 h while at home so everyday life does not become one blob)
 *     and on home <-> away transitions / continent-sized jumps.
 *  4. Tiny fragments (e.g. two airport photos before take-off) are merged into their neighbour, tiny loners are dropped.
 *  5. Every segment gets a bbox, centroid, countries, a title and `away` (majority of its photos far from home).
 */
import type { Photo } from '@shared/types';
import { haversineKm } from './geo';
import { countryName } from './countries';

export { countryName };

export interface Trip {
  id: string;
  /** epoch ms of first / last photo */
  from: number;
  to: number;
  photoIds: string[];
  /** centroid */
  lat: number;
  lon: number;
  /** [w,s,e,n] */
  bbox: [number, number, number, number];
  /** dominant place, e.g. "Tokio" / "Japan" */
  title: string;
  countries: string[];
  /** true if mostly far away from the user's home region */
  away: boolean;
}

export interface TripOptions {
  /** language for country names; defaults to the document language */
  lang?: 'de' | 'en';
  /** split on gaps longer than this many hours (default 36) */
  gapHours?: number;
  /** drop segments with fewer geotagged photos (default 3) */
  minPhotos?: number;
}

const HOUR = 36e5;
const DAY = 864e5;
const HOME_RADIUS_KM = 75;
const HOME_GAP_H = 12;
const JUMP_KM = 1500;
const TINY_PHOTOS = 4;

const docLang = (): 'de' | 'en' => {
  try {
    const l = (typeof document !== 'undefined' && document.documentElement.lang) || (typeof navigator !== 'undefined' ? navigator.language : 'de');
    return l.toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch { return 'de'; }
};

interface Home { lat: number; lon: number }

/** Most "lived-in" 1° cell: distinct months visited, then distinct days. Returns null when the library has no recurring place. */
function inferHome(lat: Float64Array, lon: Float64Array, t: Float64Array): Home | null {
  interface Cell { months: number; days: number; lastMonth: number; lastDay: number; n: number; sLat: number; sLon: number }
  const cells = new Map<number, Cell>();
  for (let i = 0; i < t.length; i++) {
    const key = Math.floor(lat[i] + 90) * 1024 + Math.floor(lon[i] + 180);
    const day = Math.floor(t[i] / DAY);
    const month = Math.floor(day / 30.4375);
    let c = cells.get(key);
    if (!c) { c = { months: 0, days: 0, lastMonth: -1e9, lastDay: -1e9, n: 0, sLat: 0, sLon: 0 }; cells.set(key, c); }
    if (month !== c.lastMonth) { c.months++; c.lastMonth = month; }
    if (day !== c.lastDay) { c.days++; c.lastDay = day; }
    c.n++; c.sLat += lat[i]; c.sLon += lon[i];
  }
  let best: Cell | null = null;
  for (const c of cells.values()) {
    if (!best || c.months > best.months || (c.months === best.months && (c.days > best.days || (c.days === best.days && c.n > best.n)))) best = c;
  }
  if (!best || best.months < 2 || best.days < 4) return null;
  // refine: centroid of everything within the radius of the cell centroid (cell may straddle the real centre)
  const cLat = best.sLat / best.n, cLon = best.sLon / best.n;
  let sLat = 0, sLon = 0, n = 0;
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(lat[i] - cLat) > 1 || Math.abs(lon[i] - cLon) > 1.6) continue;
    if (haversineKm(cLat, cLon, lat[i], lon[i]) <= HOME_RADIUS_KM) { sLat += lat[i]; sLon += lon[i]; n++; }
  }
  return n ? { lat: sLat / n, lon: sLon / n } : { lat: cLat, lon: cLon };
}

const cache = new WeakMap<Photo[], Map<string, Trip[]>>();

/** Detects trips/events: clusters of geotagged photos by time gaps + distance (home region inferred from the most-photographed area). Newest first. Memoised per input array. */
export function detectTrips(photos: Photo[], opts: TripOptions = {}): Trip[] {
  const lang = opts.lang ?? docLang();
  const gapMs = (opts.gapHours ?? 36) * HOUR;
  const minPhotos = opts.minPhotos ?? 3;
  const ckey = `${lang}|${gapMs}|${minPhotos}`;
  const hit = cache.get(photos)?.get(ckey);
  if (hit) return hit;

  const geo: Photo[] = [];
  for (const p of photos) if (p.lat != null && p.lon != null && Number.isFinite(p.lat) && Number.isFinite(p.lon)) geo.push(p);
  const n = geo.length;
  let result: Trip[] = [];
  if (n >= minPhotos) {
    geo.sort((a, b) => a.sortTime - b.sortTime);
    const t = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n);
    for (let i = 0; i < n; i++) { t[i] = geo[i].sortTime; lat[i] = geo[i].lat!; lon[i] = geo[i].lon!; }

    const home = inferHome(lat, lon, t);
    const atHome = new Uint8Array(n);
    if (home) for (let i = 0; i < n; i++) atHome[i] = haversineKm(home.lat, home.lon, lat[i], lon[i]) <= HOME_RADIUS_KM ? 1 : 0;

    // --- 1. raw segmentation (ranges [s,e) in the sorted array)
    const raw: Array<{ s: number; e: number }> = [];
    let s = 0;
    for (let i = 1; i < n; i++) {
      const gap = t[i] - t[i - 1];
      const bothHome = home !== null && atHome[i] === 1 && atHome[i - 1] === 1;
      let split = gap > (bothHome ? Math.min(gapMs, HOME_GAP_H * HOUR) : gapMs);
      if (!split && gap > 3 * HOUR) {
        if (home && atHome[i] !== atHome[i - 1]) split = true;
        else if (!bothHome && haversineKm(lat[i - 1], lon[i - 1], lat[i], lon[i]) > JUMP_KM) split = true;
      }
      if (split) { raw.push({ s, e: i }); s = i; }
    }
    raw.push({ s, e: n });

    // --- 2. merge tiny fragments into the neighbour that is within the gap
    const segs: Array<{ s: number; e: number }> = [];
    const tiny = (g: { s: number; e: number }) => g.e - g.s < TINY_PHOTOS && t[g.e - 1] - t[g.s] < 12 * HOUR;
    for (const g of raw) {
      const top = segs[segs.length - 1];
      if (top && t[g.s] - t[top.e - 1] <= gapMs && (tiny(g) || tiny(top))) top.e = g.e;
      else segs.push({ s: g.s, e: g.e });
    }

    // --- 3. finalise
    for (const g of segs) {
      const count = g.e - g.s;
      if (count < minPhotos) continue;
      result.push(finalise(geo, lat, lon, t, atHome, g.s, g.e, home !== null, lang));
    }
    result.reverse();
  }
  let byKey = cache.get(photos);
  if (!byKey) { byKey = new Map(); cache.set(photos, byKey); }
  byKey.set(ckey, result);
  return result;
}

function finalise(geo: Photo[], lat: Float64Array, lon: Float64Array, t: Float64Array, atHome: Uint8Array, s: number, e: number, hasHome: boolean, lang: 'de' | 'en'): Trip {
  const count = e - s;
  const lon0 = lon[s];
  let w = 180, so = 90, ea = -180, no = -90, sLat = 0, sLon = 0, away = 0;
  const ids: string[] = new Array(count);
  const cities = new Map<string, { n: number; name: string }>();
  const ctry = new Map<string, { n: number; name: string }>();
  let placed = 0;
  for (let i = s; i < e; i++) {
    const la = lat[i];
    let lo = lon[i];
    if (lo - lon0 > 180) lo -= 360; else if (lo - lon0 < -180) lo += 360; // unwrap across the antimeridian
    if (lo < w) w = lo; if (lo > ea) ea = lo; if (la < so) so = la; if (la > no) no = la;
    sLat += la; sLon += lo;
    if (hasHome && !atHome[i]) away++;
    const p = geo[i];
    ids[i - s] = p.id;
    const pl = p.place;
    if (pl) {
      placed++;
      if (pl.countryCode) { const c = ctry.get(pl.countryCode); if (c) c.n++; else ctry.set(pl.countryCode, { n: 1, name: pl.country }); }
      if (pl.city) { const k = `${pl.countryCode}|${pl.city}`; const c = cities.get(k); if (c) c.n++; else cities.set(k, { n: 1, name: pl.city }); }
    }
  }
  const wrap = (x: number) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
  const padLat = Math.max(0, 0.04 - (no - so)) / 2, padLon = Math.max(0, 0.06 - (ea - w)) / 2;
  const bbox: [number, number, number, number] = [wrap(w - padLon), Math.max(-90, so - padLat), wrap(ea + padLon), Math.min(90, no + padLat)];

  const countries = [...ctry.entries()].sort((a, b) => b[1].n - a[1].n).map(([cc]) => cc);
  const topCity = [...cities.values()].sort((a, b) => b.n - a.n)[0];
  const cn = (cc: string) => countryName(cc, lang, ctry.get(cc)?.name);
  let title: string;
  if (topCity && topCity.n / placed > 0.5) title = topCity.name;
  else if (countries.length === 1) title = cn(countries[0]);
  else if (countries.length > 1) {
    const top = ctry.get(countries[0])!;
    title = top.n / placed >= 0.6 ? cn(countries[0]) : countries.length === 2 ? `${cn(countries[0])} · ${cn(countries[1])}` : `${cn(countries[0])} · ${cn(countries[1])} +${countries.length - 2}`;
  } else if (topCity) title = topCity.name;
  else title = `${Math.abs(sLat / count).toFixed(1)}°${sLat >= 0 ? 'N' : 'S'} ${Math.abs(wrap(sLon / count)).toFixed(1)}°${wrap(sLon / count) >= 0 ? 'E' : 'W'}`;

  return {
    id: `trip-${t[s]}-${geo[s].id}`,
    from: t[s], to: t[e - 1],
    photoIds: ids,
    lat: sLat / count, lon: wrap(sLon / count),
    bbox, title, countries,
    away: hasHome && away / count >= 0.5,
  };
}
