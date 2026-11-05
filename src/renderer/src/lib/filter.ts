import type { Photo, AreaSelection, MediaKind } from '@shared/types';
import { photoInArea } from './geo';

export interface Filters {
  /** free text: matches file name, city, region, country, camera, lens, tags, year, month names */
  query: string;
  /** timeline range [from,to] epoch ms (inclusive) */
  range: [number, number] | null;
  kinds: MediaKind[];
  favoritesOnly: boolean;
  location: 'any' | 'with' | 'without';
  cameras: string[];
  countries: string[]; // ISO codes
  sourceIds: string[];
  minRating: number;
  tags: string[];
  /** polygon selected on the map (+optional time window) */
  area: AreaSelection | null;
}

export const EMPTY_FILTERS: Filters = {
  query: '', range: null, kinds: [], favoritesOnly: false, location: 'any', cameras: [],
  countries: [], sourceIds: [], minRating: 0, tags: [], area: null,
};

export function activeFilterCount(f: Filters, opts: { ignoreRange?: boolean } = {}): number {
  let n = 0;
  if (f.query.trim()) n++;
  if (f.range && !opts.ignoreRange) n++;
  if (f.kinds.length) n++;
  if (f.favoritesOnly) n++;
  if (f.location !== 'any') n++;
  if (f.cameras.length) n++;
  if (f.countries.length) n++;
  if (f.sourceIds.length) n++;
  if (f.minRating > 0) n++;
  if (f.tags.length) n++;
  if (f.area) n++;
  return n;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MONTHS: Record<string, number> = {
  januar: 0, january: 0, jan: 0, februar: 1, february: 1, feb: 1, maerz: 2, marz: 2, march: 2, mar: 2, april: 3, apr: 3,
  mai: 4, may: 4, juni: 5, june: 5, jun: 5, juli: 6, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  oktober: 9, october: 9, okt: 9, oct: 9, november: 10, nov: 10, dezember: 11, december: 11, dez: 11, dec: 11,
};

/** Build a predicate for the text query. Every whitespace-separated token must match (AND). */
export function textMatcher(query: string): ((p: Photo) => boolean) | null {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return (p) => {
    const d = new Date(p.sortTime);
    const hay = norm([p.name, p.place?.city, p.place?.region, p.place?.country, p.place?.countryCode, p.camera, p.lens, p.kind === 'video' ? 'video' : 'foto photo', ...p.tags].filter(Boolean).join(' '));
    return tokens.every((t) => {
      if (hay.includes(t)) return true;
      if (/^\d{4}$/.test(t)) return d.getUTCFullYear() === +t;
      if (t in MONTHS) return d.getUTCMonth() === MONTHS[t];
      return false;
    });
  };
}

export function applyFilters(photos: Photo[], f: Filters, opts: { ignoreRange?: boolean } = {}): Photo[] {
  const text = textMatcher(f.query);
  const kinds = f.kinds.length ? new Set(f.kinds) : null;
  const cams = f.cameras.length ? new Set(f.cameras) : null;
  const countries = f.countries.length ? new Set(f.countries) : null;
  const sources = f.sourceIds.length ? new Set(f.sourceIds) : null;
  const range = opts.ignoreRange ? null : f.range;
  return photos.filter((p) => {
    if (range && (p.sortTime < range[0] || p.sortTime > range[1])) return false;
    if (kinds && !kinds.has(p.kind)) return false;
    if (f.favoritesOnly && !p.favorite) return false;
    if (f.location === 'with' && p.lat == null) return false;
    if (f.location === 'without' && p.lat != null) return false;
    if (cams && !(p.camera && cams.has(p.camera))) return false;
    if (countries && !(p.place && countries.has(p.place.countryCode))) return false;
    if (sources && !sources.has(p.sourceId)) return false;
    if (p.rating < f.minRating) return false;
    if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) return false;
    if (f.area && !photoInArea(p, f.area)) return false;
    if (text && !text(p)) return false;
    return true;
  });
}
