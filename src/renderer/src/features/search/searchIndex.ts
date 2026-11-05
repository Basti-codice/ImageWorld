import type { Photo } from '@shared/types';
import { cityKey } from '@/lib/filter';

export type BBox = [number, number, number, number];

export interface PlaceEntry { key: string; city: string; country: string; cc: string; count: number; bbox: BBox | null }
export interface CountryEntry { cc: string; name: string; count: number; bbox: BBox | null }
export interface MonthEntry { year: number; month: number; count: number; from: number; to: number }
export interface YearEntry { year: number; count: number; from: number; to: number }
export interface Named { name: string; count: number }

export interface LibraryIndex {
  photos: Photo[];
  /** newest first */
  byTime: Photo[];
  places: PlaceEntry[];
  countries: CountryEntry[];
  years: YearEntry[];
  months: MonthEntry[];
  cameras: Named[];
  lenses: Named[];
  tags: Named[];
}

const grow = (b: BBox | null, lon: number, lat: number): BBox => (b ? [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)] : [lon, lat, lon, lat]);

/** bbox with a minimum extent so that flying to a single-photo place still frames a reasonable area */
export function padBBox(b: BBox, minSpan = 0.08): BBox {
  const [w, s, e, n] = b;
  const dx = Math.max(0, (minSpan - (e - w)) / 2), dy = Math.max(0, (minSpan - (n - s)) / 2);
  return [w - dx, s - dy, e + dx, n + dy];
}

export function startOfYear(y: number) { return Date.UTC(y, 0, 1); }
export function endOfYear(y: number) { return Date.UTC(y + 1, 0, 1) - 1; }
export function startOfMonth(y: number, m: number) { return Date.UTC(y, m, 1); }
export function endOfMonth(y: number, m: number) { return Date.UTC(y, m + 1, 1) - 1; }

function build(photos: Photo[]): LibraryIndex {
  const places = new Map<string, PlaceEntry>();
  const countries = new Map<string, CountryEntry>();
  const years = new Map<number, YearEntry>();
  const months = new Map<number, MonthEntry>();
  const cams = new Map<string, number>(), lenses = new Map<string, number>(), tags = new Map<string, number>();
  for (const p of photos) {
    if (p.place) {
      const key = cityKey(p.place.countryCode, p.place.city);
      let pe = places.get(key);
      if (!pe) { pe = { key, city: p.place.city, country: p.place.country, cc: p.place.countryCode, count: 0, bbox: null }; places.set(key, pe); }
      pe.count++;
      let ce = countries.get(p.place.countryCode);
      if (!ce) { ce = { cc: p.place.countryCode, name: p.place.country, count: 0, bbox: null }; countries.set(p.place.countryCode, ce); }
      ce.count++;
      if (p.lat != null && p.lon != null) { pe.bbox = grow(pe.bbox, p.lon, p.lat); ce.bbox = grow(ce.bbox, p.lon, p.lat); }
    }
    const d = new Date(p.sortTime);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const ye = years.get(y) ?? { year: y, count: 0, from: startOfYear(y), to: endOfYear(y) };
    ye.count++; years.set(y, ye);
    const mk = y * 12 + m;
    const me = months.get(mk) ?? { year: y, month: m, count: 0, from: startOfMonth(y, m), to: endOfMonth(y, m) };
    me.count++; months.set(mk, me);
    if (p.camera) cams.set(p.camera, (cams.get(p.camera) ?? 0) + 1);
    if (p.lens) lenses.set(p.lens, (lenses.get(p.lens) ?? 0) + 1);
    for (const t of p.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const named = (m: Map<string, number>): Named[] => [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return {
    photos,
    byTime: [...photos].sort((a, b) => b.sortTime - a.sortTime),
    places: [...places.values()].sort((a, b) => b.count - a.count),
    countries: [...countries.values()].sort((a, b) => b.count - a.count),
    years: [...years.values()].sort((a, b) => b.year - a.year),
    months: [...months.values()].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)),
    cameras: named(cams), lenses: named(lenses), tags: named(tags),
  };
}

let cache: LibraryIndex | null = null;
/** Aggregated library facets (places, time, cameras, …) – rebuilt only when the photo array changes. */
export function getIndex(photos: Photo[]): LibraryIndex {
  if (!cache || cache.photos !== photos) cache = build(photos);
  return cache;
}
