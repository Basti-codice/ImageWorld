import type { Album, Photo } from '@shared/types';
import { currentLocale, t, tn, useLang } from '@/i18n';
import { countryName } from '@/lib/countries';
import { polygonBBox } from '@/lib/geo';

type BBox = [number, number, number, number];

/** [min, max] sortTime of the photos, or null when empty. */
export function timeSpan(photos: Photo[]): [number, number] | null {
  if (!photos.length) return null;
  let a = Infinity, b = -Infinity;
  for (const p of photos) { if (p.sortTime < a) a = p.sortTime; if (p.sortTime > b) b = p.sortTime; }
  return [a, b];
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(currentLocale(), { timeZone: 'UTC', ...opts });

/** "14.–18. Mai 2023", "14. Mai 2023", "Mai – Juli 2023" … ; `month` mode collapses to months/years. */
export function dateRangeLabel(from: number, to: number, mode: 'day' | 'month' = 'day', short = false): string {
  const o: Intl.DateTimeFormatOptions = mode === 'month'
    ? { month: short ? 'short' : 'long', year: 'numeric' }
    : { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' };
  const f = fmt(o);
  try { return f.formatRange(from, to); } catch { return f.format(from); }
}

const countryLabel = (cc: string, fallback?: string) => countryName(cc, useLang.getState().lang, fallback);

interface PlaceCount { name: string; n: number }
function countBy(photos: Photo[], key: (p: Photo) => string | undefined): PlaceCount[] {
  const m = new Map<string, number>();
  for (const p of photos) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

/** "Tokio, Kyoto +2" – dominant cities (or countries when the album spans many cities). */
export function placeSummary(photos: Photo[], max = 2): string {
  const cities = countBy(photos, (p) => p.place?.city);
  if (!cities.length) return '';
  const countries = countBy(photos, (p) => (p.place ? countryLabel(p.place.countryCode, p.place.country) : undefined));
  if (cities.length > 4 && countries.length > 1) {
    const names = countries.slice(0, max).map((c) => c.name);
    const rest = countries.length - names.length;
    return names.join(', ') + (rest > 0 ? ` +${rest}` : '');
  }
  const names = cities.slice(0, max).map((c) => c.name);
  const rest = cities.length - names.length;
  return names.join(', ') + (rest > 0 ? ` +${rest}` : '');
}

/** Number of distinct countries, for hero meta. */
export function countryCount(photos: Photo[]): number {
  return new Set(photos.map((p) => p.place?.countryCode).filter(Boolean)).size;
}

/** Smart default album name: "Rom · Mai 2023". */
export function smartAlbumName(photos: Photo[]): string {
  const span = timeSpan(photos);
  const date = span ? dateRangeLabel(span[0], span[1], 'month') : '';
  let place = '';
  const cities = countBy(photos, (p) => p.place?.city);
  if (cities.length) {
    const geo = photos.filter((p) => p.place).length || 1;
    if (cities[0].n / geo >= 0.5) place = cities[0].name;
    else {
      const countries = countBy(photos, (p) => (p.place ? countryLabel(p.place.countryCode, p.place.country) : undefined));
      place = countries[0] && countries[0].n / geo >= 0.5 ? countries[0].name : cities[0].name;
    }
  }
  if (place && date) return `${place} · ${date}`;
  if (place) return place;
  if (date) return t('albums.name.fallback', { date });
  return t('albums.name.new');
}

/** Evenly spread sample of up to n photos (for mosaics/previews). */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * (items.length - 1)) / (n - 1))]);
  return out;
}

export function geoPhotos(photos: Photo[]): Photo[] { return photos.filter((p) => p.lat != null && p.lon != null); }

/** [w,s,e,n] of the album: its area polygon when set, else the bbox of geotagged photos. */
export function albumBBox(album: Album, photos: Photo[]): BBox | null {
  if (album.area?.polygon.length) return polygonBBox(album.area.polygon);
  const g = geoPhotos(photos);
  if (!g.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of g) { w = Math.min(w, p.lon!); e = Math.max(e, p.lon!); s = Math.min(s, p.lat!); n = Math.max(n, p.lat!); }
  return [w, s, e, n];
}

/** Meta line: "24 Fotos · 14.–18. Mai 2023" */
export function albumMeta(photos: Photo[], short = true): string {
  const span = timeSpan(photos);
  const parts = [tn('common.photos', photos.length)];
  if (span) parts.push(dateRangeLabel(span[0], span[1], 'day', short));
  return parts.join(' · ');
}
