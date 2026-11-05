import type { Photo } from '@shared/types';
import { haversineKm } from '@/lib/geo';

const DAY = 864e5;

export interface YearBucket { year: number; photos: number; videos: number }
export interface Counted { key: string; label: string; count: number }
export interface Stats {
  total: number; photos: number; videos: number; bytes: number;
  countries: number; cities: number;
  firstYear: number | null; lastYear: number | null;
  perYear: YearBucket[];
  /** day index (epoch days, UTC) → photo count */
  daily: Map<number, number>;
  activeDays: number;
  yearsWithData: number[];
  hours: number[]; weekdays: number[]; timeKnown: number;
  topCities: Array<{ key: string; city: string; cc: string; count: number }>;
  cameras: Counted[]; lenses: Counted[];
  focal: number[]; aperture: number[];
  favorites: number; ratings: number[]; rated: number;
  busiest: { day: number; count: number } | null;
  streak: { from: number; to: number; len: number } | null;
  home: { city: string; cc: string } | null;
  furthest: { city: string; cc: string; km: number; lat: number; lon: number } | null;
}

export const FOCAL_BINS: Array<{ max: number; label: string; range?: string }> = [
  { max: 17, label: '≤16' }, { max: 25, label: '≤24', range: '17–24' }, { max: 36, label: '≤35', range: '25–35' }, { max: 51, label: '≤50', range: '36–50' },
  { max: 86, label: '≤85', range: '51–85' }, { max: 136, label: '≤135', range: '86–135' }, { max: 301, label: '≤300', range: '136–300' }, { max: Infinity, label: '>300' },
];
export const APERTURE_BINS: Array<{ max: number; label: string }> = [
  { max: 1.5, label: 'f/1.4' }, { max: 2.1, label: 'f/2' }, { max: 3.0, label: 'f/2.8' }, { max: 4.5, label: 'f/4' },
  { max: 6.3, label: 'f/5.6' }, { max: 9, label: 'f/8' }, { max: 12.5, label: 'f/11' }, { max: Infinity, label: 'f/16+' },
];
const binOf = (bins: Array<{ max: number }>, v: number) => { for (let i = 0; i < bins.length; i++) if (v < bins[i].max) return i; return bins.length - 1; };

let lastPhotos: Photo[] | null = null;
let lastStats: Stats | null = null;

/** Cleans up verbose lens strings, e.g. "iPhone 15 Pro back camera 6.86mm f/1.78" stays as is but trims whitespace. */
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Single pass over the whole library; memoised on array identity. */
export function computeStats(photos: Photo[]): Stats {
  if (lastPhotos === photos && lastStats) return lastStats;

  let videos = 0, bytes = 0, favorites = 0, rated = 0, timeKnown = 0;
  const years = new Map<number, YearBucket>();
  const daily = new Map<number, number>();
  const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0);
  const focal = new Array(FOCAL_BINS.length).fill(0), aperture = new Array(APERTURE_BINS.length).fill(0);
  const ratings = new Array(6).fill(0);
  const cams = new Map<string, number>(), lenses = new Map<string, number>();
  const countries = new Set<string>();
  const cities = new Map<string, { city: string; cc: string; count: number; sLat: number; sLon: number; geo: number }>();

  for (const p of photos) {
    const isVideo = p.kind === 'video';
    if (isVideo) videos++;
    bytes += p.size;
    if (p.favorite) favorites++;
    if (p.rating > 0) { rated++; ratings[Math.min(5, p.rating)]++; }

    const d = new Date(p.sortTime);
    const y = d.getUTCFullYear();
    let yb = years.get(y); if (!yb) { yb = { year: y, photos: 0, videos: 0 }; years.set(y, yb); }
    if (isVideo) yb.videos++; else yb.photos++;
    const dk = Math.floor(p.sortTime / DAY);
    daily.set(dk, (daily.get(dk) ?? 0) + 1);
    if (p.takenAt != null) { timeKnown++; hours[d.getUTCHours()]++; weekdays[(d.getUTCDay() + 6) % 7]++; }

    if (p.camera) { const k = tidy(p.camera); cams.set(k, (cams.get(k) ?? 0) + 1); }
    if (p.lens) { const k = tidy(p.lens); lenses.set(k, (lenses.get(k) ?? 0) + 1); }
    if (p.focalLength) focal[binOf(FOCAL_BINS, p.focalLength)]++;
    if (p.aperture) aperture[binOf(APERTURE_BINS, p.aperture)]++;

    const pl = p.place;
    if (pl?.countryCode) {
      countries.add(pl.countryCode);
      const city = pl.city || pl.region || pl.country;
      const k = `${pl.countryCode}\u0000${city}`;
      let c = cities.get(k); if (!c) { c = { city, cc: pl.countryCode, count: 0, sLat: 0, sLon: 0, geo: 0 }; cities.set(k, c); }
      c.count++;
      if (p.lat != null && p.lon != null) { c.sLat += p.lat; c.sLon += p.lon; c.geo++; }
    }
  }

  const ys = [...years.keys()].sort((a, b) => a - b);
  const firstYear = ys[0] ?? null, lastYear = ys[ys.length - 1] ?? null;
  const perYear: YearBucket[] = [];
  if (firstYear != null && lastYear != null) for (let y = firstYear; y <= lastYear; y++) perYear.push(years.get(y) ?? { year: y, photos: 0, videos: 0 });

  // busiest day + longest streak
  let busiest: Stats['busiest'] = null;
  const dayKeys = [...daily.keys()].sort((a, b) => a - b);
  for (const k of dayKeys) { const n = daily.get(k)!; if (!busiest || n > busiest.count) busiest = { day: k, count: n }; }
  let streak: Stats['streak'] = null;
  let runStart = dayKeys[0], prev = dayKeys[0];
  for (let i = 1; i <= dayKeys.length; i++) {
    const k = dayKeys[i];
    if (k !== prev + 1) {
      const len = prev - runStart + 1;
      if (!streak || len > streak.len) streak = { from: runStart, to: prev, len };
      runStart = k;
    }
    prev = k;
  }

  const cityList = [...cities.values()].sort((a, b) => b.count - a.count);
  const topCities = cityList.slice(0, 8).map((c) => ({ key: `${c.cc}:${c.city}`, city: c.city, cc: c.cc, count: c.count }));

  // furthest place from home (home = most photographed geotagged city)
  const geoCities = cityList.filter((c) => c.geo > 0);
  let home: Stats['home'] = null, furthest: Stats['furthest'] = null;
  if (geoCities.length > 1) {
    const h = geoCities[0];
    home = { city: h.city, cc: h.cc };
    const hl = h.sLat / h.geo, ho = h.sLon / h.geo;
    let best = 0;
    for (const c of geoCities) {
      const lat = c.sLat / c.geo, lon = c.sLon / c.geo;
      const km = haversineKm(hl, ho, lat, lon);
      if (km > best) { best = km; furthest = { city: c.city, cc: c.cc, km, lat, lon }; }
    }
  }

  const rank = (m: Map<string, number>): Counted[] => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ key: label, label, count }));

  lastPhotos = photos;
  lastStats = {
    total: photos.length, photos: photos.length - videos, videos, bytes,
    countries: countries.size, cities: cities.size, firstYear, lastYear, perYear,
    daily, activeDays: daily.size, yearsWithData: ys, hours, weekdays, timeKnown,
    topCities, cameras: rank(cams), lenses: rank(lenses), focal, aperture,
    favorites, ratings, rated, busiest, streak, home, furthest,
  };
  return lastStats;
}

export const dayStart = (dayIndex: number) => dayIndex * DAY;
export const dayRange = (dayIndex: number): [number, number] => [dayIndex * DAY, (dayIndex + 1) * DAY - 1];
export const yearRange = (y: number): [number, number] => [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1) - 1];
