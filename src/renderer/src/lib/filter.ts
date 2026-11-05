import type { Photo, AreaSelection, MediaKind } from '@shared/types';
import { photoInArea } from './geo';

export interface Filters {
  /** free text: matches file name, city, region, country, camera, lens, tags, year, month names (tokens are AND-ed) */
  query: string;
  /** timeline range [from,to] epoch ms (inclusive) */
  range: [number, number] | null;
  kinds: MediaKind[];
  favoritesOnly: boolean;
  location: 'any' | 'with' | 'without';
  cameras: string[];
  /** lens model names (exact match) */
  lenses: string[];
  /** cities as "<countryCode>|<city>" – build with `cityKey()` */
  cities: string[];
  countries: string[]; // ISO codes
  sourceIds: string[];
  minRating: number;
  tags: string[];
  /** polygon selected on the map (+optional time window) */
  area: AreaSelection | null;
}

export const EMPTY_FILTERS: Filters = {
  query: '', range: null, kinds: [], favoritesOnly: false, location: 'any', cameras: [], lenses: [], cities: [],
  countries: [], sourceIds: [], minRating: 0, tags: [], area: null,
};

export const cityKey = (cc: string, city: string) => `${cc}|${city}`;
export const splitCityKey = (key: string): { cc: string; city: string } => {
  const i = key.indexOf('|');
  return { cc: key.slice(0, i), city: key.slice(i + 1) };
};

export function activeFilterCount(f: Filters, opts: { ignoreRange?: boolean } = {}): number {
  let n = 0;
  if (f.query.trim()) n++;
  if (f.range && !opts.ignoreRange) n++;
  if (f.kinds.length) n++;
  if (f.favoritesOnly) n++;
  if (f.location !== 'any') n++;
  if (f.cameras.length) n++;
  if (f.lenses?.length) n++;
  if (f.cities?.length) n++;
  if (f.countries.length) n++;
  if (f.sourceIds.length) n++;
  if (f.minRating > 0) n++;
  if (f.tags.length) n++;
  if (f.area) n++;
  return n;
}

/** lower-case + strip diacritics (ü → u, é → e) */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const MONTHS: Record<string, number> = {
  januar: 0, january: 0, jan: 0, jaenner: 0, februar: 1, february: 1, feb: 1, maerz: 2, marz: 2, march: 2, mar: 2, april: 3, apr: 3,
  mai: 4, may: 4, juni: 5, june: 5, jun: 5, juli: 6, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  oktober: 9, october: 9, okt: 9, oct: 9, november: 10, nov: 10, dezember: 11, december: 11, dez: 11, dec: 11,
};

/** words that select a media kind / favorites instead of matching text */
const KIND_WORDS: Record<string, 'video' | 'photo' | 'fav'> = {
  video: 'video', videos: 'video', film: 'video', filme: 'video', movie: 'video', movies: 'video', clip: 'video', clips: 'video',
  foto: 'photo', fotos: 'photo', photo: 'photo', photos: 'photo', bild: 'photo', bilder: 'photo', image: 'photo', images: 'photo',
  favorit: 'fav', favoriten: 'fav', favorite: 'fav', favorites: 'fav', favourite: 'fav', favourites: 'fav', herz: 'fav',
};

export const isKindWord = (token: string) => token in KIND_WORDS;
export const isYearToken = (token: string) => /^(19|20)\d{2}$/.test(token);

/** Normalised word tokens of a free-text query. */
export function queryTokens(query: string): string[] {
  return norm(query).split(/[\s,;]+/).filter(Boolean);
}

// per-photo normalised "haystack" (space separated words, with a leading space) – built lazily, cached by object identity
const hayCache = new WeakMap<Photo, string>();
const WORDS = /[^\p{L}\p{N}]+/gu;
function hayOf(p: Photo): string {
  let h = hayCache.get(p);
  if (h === undefined) {
    h = ' ' + norm([p.name, p.ext, p.place?.city, p.place?.region, p.place?.country, p.place?.countryCode, p.camera, p.lens, ...p.tags].filter(Boolean).join(' ')).replace(WORDS, ' ');
    hayCache.set(p, h);
  }
  return h;
}

type Pred = (p: Photo, d: () => Date) => boolean;

function tokenPredicate(t: string): Pred {
  const kw = KIND_WORDS[t];
  if (kw === 'video') return (p) => p.kind === 'video';
  if (kw === 'photo') return (p) => p.kind === 'photo';
  if (kw === 'fav') return (p) => p.favorite;
  // "2023-07" / "07/2023" / "7.2023"
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(t) ?? undefined;
  if (m) { const y = +m[1], mo = +m[2] - 1; return (p, d) => d().getUTCFullYear() === y && d().getUTCMonth() === mo; }
  m = /^(\d{1,2})[./](\d{4})$/.exec(t) ?? undefined;
  if (m) { const y = +m[2], mo = +m[1] - 1; return (p, d) => d().getUTCFullYear() === y && d().getUTCMonth() === mo; }
  // "2023-07-14" / "14.07.2023"
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t) ?? undefined;
  if (m) { const y = +m[1], mo = +m[2] - 1, da = +m[3]; return (p, d) => d().getUTCFullYear() === y && d().getUTCMonth() === mo && d().getUTCDate() === da; }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(t) ?? undefined;
  if (m) { const da = +m[1], mo = +m[2] - 1, y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return (p, d) => d().getUTCFullYear() === y && d().getUTCMonth() === mo && d().getUTCDate() === da; }
  const word = ' ' + t;
  const substr = t.length >= 4;
  const wordHit = (p: Photo) => { const h = hayOf(p); return h.includes(word) || (substr && h.includes(t)); };
  if (/^(19|20)\d{2}$/.test(t)) { const y = +t; return (p, d) => d().getUTCFullYear() === y || wordHit(p); }
  if (t in MONTHS) { const mo = MONTHS[t]; return (p, d) => d().getUTCMonth() === mo || wordHit(p); }
  return wordHit;
}

/**
 * Build a predicate for the text query. Every whitespace-separated token must match (AND), case/accent-insensitive.
 * A token matches at the start of any word of name/place/camera/lens/tags ("rom" → Rom, Rome – not "Chrome"; ≥ 4 chars also inside words: "phone" → iPhone),
 * a year ("2023"), a month name ("juli", "july"), a date ("14.07.2023", "2023-07"), or a kind keyword ("video", "foto", "favoriten").
 * Examples: "rom 2023", "iphone juli", "video 2022".
 */
export function textMatcher(query: string): ((p: Photo) => boolean) | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;
  const preds = tokens.map(tokenPredicate);
  return (p) => {
    let date: Date | null = null;
    const d = () => (date ??= new Date(p.sortTime));
    for (let i = 0; i < preds.length; i++) if (!preds[i](p, d)) return false;
    return true;
  };
}

interface Compiled {
  text: ((p: Photo) => boolean) | null;
  kinds: Set<MediaKind> | null;
  cams: Set<string> | null;
  lenses: Set<string> | null;
  cities: Set<string> | null;
  countries: Set<string> | null;
  sources: Set<string> | null;
  range: [number, number] | null;
}
function compile(f: Filters, opts: { ignoreRange?: boolean }): Compiled {
  return {
    text: textMatcher(f.query),
    kinds: f.kinds.length ? new Set(f.kinds) : null,
    cams: f.cameras.length ? new Set(f.cameras) : null,
    lenses: f.lenses?.length ? new Set(f.lenses) : null,
    cities: f.cities?.length ? new Set(f.cities) : null,
    countries: f.countries.length ? new Set(f.countries) : null,
    sources: f.sourceIds.length ? new Set(f.sourceIds) : null,
    range: opts.ignoreRange ? null : f.range,
  };
}

export function applyFilters(photos: Photo[], f: Filters, opts: { ignoreRange?: boolean } = {}): Photo[] {
  const c = compile(f, opts);
  return photos.filter((p) => {
    if (c.range && (p.sortTime < c.range[0] || p.sortTime > c.range[1])) return false;
    if (c.kinds && !c.kinds.has(p.kind)) return false;
    if (f.favoritesOnly && !p.favorite) return false;
    if (f.location === 'with' && p.lat == null) return false;
    if (f.location === 'without' && p.lat != null) return false;
    if (c.cams && !(p.camera && c.cams.has(p.camera))) return false;
    if (c.lenses && !(p.lens && c.lenses.has(p.lens))) return false;
    if (c.cities && !(p.place && c.cities.has(cityKey(p.place.countryCode, p.place.city)))) return false;
    if (c.countries && !(p.place && c.countries.has(p.place.countryCode))) return false;
    if (c.sources && !c.sources.has(p.sourceId)) return false;
    if (p.rating < f.minRating) return false;
    if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) return false;
    if (f.area && !photoInArea(p, f.area)) return false;
    if (c.text && !c.text(p)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ facet counts */

export interface FacetCounts {
  /** photos matching ALL filters */
  total: number;
  kinds: { photo: number; video: number };
  favorites: number;
  location: { with: number; without: number };
  /** rating[n] = photos with rating >= n (n = 1..5) */
  rating: number[];
  cameras: Map<string, number>;
  lenses: Map<string, number>;
  countries: Map<string, number>;
  sources: Map<string, number>;
  tags: Map<string, number>;
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Live counts for the filter popover: for every option of a facet, how many photos would match if exactly this option were selected
 * while all OTHER filters stay as they are (single pass, O(n)).
 */
export function facetCounts(photos: Photo[], f: Filters): FacetCounts {
  const c = compile(f, {});
  const out: FacetCounts = {
    total: 0, kinds: { photo: 0, video: 0 }, favorites: 0, location: { with: 0, without: 0 }, rating: [0, 0, 0, 0, 0, 0],
    cameras: new Map(), lenses: new Map(), countries: new Map(), sources: new Map(), tags: new Map(),
  };
  const BASE = 1, KIND = 2, FAV = 4, LOC = 8, CAM = 16, LENS = 32, CTRY = 64, SRC = 128, RATE = 256, TAG = 512, CITY = 1024;
  for (const p of photos) {
    let m = 0;
    if ((c.range && (p.sortTime < c.range[0] || p.sortTime > c.range[1])) || (f.area && !photoInArea(p, f.area)) || (c.text && !c.text(p))) m |= BASE;
    if (c.kinds && !c.kinds.has(p.kind)) m |= KIND;
    if (f.favoritesOnly && !p.favorite) m |= FAV;
    if ((f.location === 'with' && p.lat == null) || (f.location === 'without' && p.lat != null)) m |= LOC;
    if (c.cams && !(p.camera && c.cams.has(p.camera))) m |= CAM;
    if (c.lenses && !(p.lens && c.lenses.has(p.lens))) m |= LENS;
    if (c.countries && !(p.place && c.countries.has(p.place.countryCode))) m |= CTRY;
    if (c.sources && !c.sources.has(p.sourceId)) m |= SRC;
    if (p.rating < f.minRating) m |= RATE;
    if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) m |= TAG;
    if (c.cities && !(p.place && c.cities.has(cityKey(p.place.countryCode, p.place.city)))) m |= CITY;
    if (m === 0) out.total++;
    if (!(m & ~KIND)) out.kinds[p.kind]++;
    if (!(m & ~FAV) && p.favorite) out.favorites++;
    if (!(m & ~LOC)) out.location[p.lat != null ? 'with' : 'without']++;
    if (!(m & ~RATE)) for (let r = 1; r <= p.rating && r <= 5; r++) out.rating[r]++;
    if (!(m & ~CAM) && p.camera) bump(out.cameras, p.camera);
    if (!(m & ~LENS) && p.lens) bump(out.lenses, p.lens);
    if (!(m & ~CTRY) && p.place) bump(out.countries, p.place.countryCode);
    if (!(m & ~SRC)) bump(out.sources, p.sourceId);
    if (m === 0) for (const t of p.tags) bump(out.tags, t); // tags are AND-ed: adding one narrows the current result
  }
  return out;
}
