// Offline reverse geocoding + local forward search (all-the-cities + kdbush/geokdbush).
// Pure module (no electron) – runs inside a worker_thread in the app, directly in tests.
import KDBush from 'kdbush';
import { around, distance } from 'geokdbush';
import type { GeocodeResult, Place } from '@shared/types';

interface City {
  name: string;
  altName?: string;
  country: string;
  population: number;
  loc: { coordinates: [number, number] };
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const REVERSE_MAX_KM = 100;

export class PlaceIndex {
  private readonly lon: Float64Array;
  private readonly lat: Float64Array;
  private readonly names: string[];
  private readonly alts: string[];
  private readonly nameN: string[];
  private readonly altN: string[];
  private readonly cc: string[];
  private readonly pop: Uint32Array;
  private readonly tree: KDBush;
  private readonly countryNames = new Map<string, { en: string; de: string }>();
  private readonly dn: Record<string, Intl.DisplayNames> = {};
  private bboxCache = new Map<string, { bbox: [number, number, number, number]; lat: number; lon: number }>();

  constructor(cities: City[]) {
    const n = cities.length;
    this.lon = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.pop = new Uint32Array(n);
    this.names = new Array(n);
    this.alts = new Array(n);
    this.nameN = new Array(n);
    this.altN = new Array(n);
    this.cc = new Array(n);
    this.tree = new KDBush(n);
    for (let i = 0; i < n; i++) {
      const c = cities[i];
      this.lon[i] = c.loc.coordinates[0];
      this.lat[i] = c.loc.coordinates[1];
      this.pop[i] = c.population || 0;
      this.names[i] = c.name;
      this.alts[i] = c.altName ?? '';
      this.nameN[i] = norm(c.name);
      this.altN[i] = c.altName ? norm(c.altName) : '';
      this.cc[i] = (c.country || '').toUpperCase();
      this.tree.add(this.lon[i], this.lat[i]);
      if (!this.countryNames.has(this.cc[i])) this.countryNames.set(this.cc[i], { en: '', de: '' });
    }
    this.tree.finish();
    for (const [code, v] of this.countryNames) {
      v.en = this.regionName(code, 'en');
      v.de = this.regionName(code, 'de');
    }
  }

  get size() { return this.names.length; }

  private regionName(code: string, lang: string): string {
    try {
      this.dn[lang] ??= new Intl.DisplayNames([lang], { type: 'region' });
      return this.dn[lang].of(code) ?? code;
    } catch {
      return code;
    }
  }

  countryName(code: string, lang = 'en'): string {
    const c = this.countryNames.get(code.toUpperCase());
    if (c) return lang === 'de' ? c.de : c.en;
    return this.regionName(code.toUpperCase(), lang);
  }

  /**
   * Nearest populated place (>= 1000 inhabitants) within ~100 km. Districts of big cities (Berlin-Mitte, Manhattan…)
   * are lifted to the city: among everything within max(6 km, 1.5 × nearest distance) the most populous place wins.
   */
  reverse(lat: number, lon: number): Place | undefined {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
    const nearest = around(this.tree, lon, lat, 1, REVERSE_MAX_KM);
    if (!nearest.length) return undefined;
    let i = nearest[0];
    const d0 = distance(lon, lat, this.lon[i], this.lat[i]);
    const near = around(this.tree, lon, lat, 30, Math.max(6, d0 * 1.5));
    for (const j of near) if (this.pop[j] > this.pop[i]) i = j;
    const code = this.cc[i];
    return { city: this.names[i], country: this.countryName(code, 'en'), countryCode: code };
  }

  reverseMany(points: Array<[number, number]>): Array<Place | undefined> {
    return points.map(([la, lo]) => this.reverse(la, lo));
  }

  private countryBox(code: string): { bbox: [number, number, number, number]; lat: number; lon: number } | null {
    const hit = this.bboxCache.get(code);
    if (hit) return hit;
    const lats: number[] = [];
    const lons: number[] = [];
    for (let i = 0; i < this.cc.length; i++) {
      if (this.cc[i] === code) { lats.push(this.lat[i]); lons.push(this.lon[i]); }
    }
    if (!lats.length) return null;
    lats.sort((a, b) => a - b);
    lons.sort((a, b) => a - b);
    // trim 2 % outliers on each side (overseas territories, Alaska/Hawaii, …)
    const cut = lats.length > 50 ? Math.floor(lats.length * 0.02) : 0;
    const s = lats[cut];
    const nn = lats[lats.length - 1 - cut];
    const w = lons[cut];
    const e = lons[lons.length - 1 - cut];
    let bbox: [number, number, number, number] = [w, s, e, nn];
    // single-city "countries": give a small box so the map does not zoom to street level
    if (e - w < 0.2) bbox = [w - 0.1, s - 0.1, e + 0.1, nn + 0.1];
    const v = { bbox, lat: (s + nn) / 2, lon: (w + e) / 2 };
    this.bboxCache.set(code, v);
    return v;
  }

  /** Local forward search over countries and cities (accent/case-insensitive, prefix first, then by population). */
  search(query: string, lang = 'en', limit = 8): GeocodeResult[] {
    const q = norm(query);
    if (q.length < 2) return [];
    const loc = lang === 'de' ? 'de' : 'en';
    type Hit = { rank: number; pop: number; res: () => GeocodeResult };
    const hits: Hit[] = [];

    // countries
    for (const [code, names] of this.countryNames) {
      const cands = [norm(names.en), norm(names.de), code.toLowerCase()];
      let rank = 9;
      for (const c of cands) {
        if (c === q) rank = Math.min(rank, 0);
        else if (c.startsWith(q) && q.length >= 3) rank = Math.min(rank, 1);
      }
      if (code.toLowerCase() === q && q.length === 2) rank = Math.min(rank, 1);
      if (rank < 9) {
        hits.push({
          rank: rank - 0.5, // countries win ties against cities of the same name
          pop: 1e10,
          res: () => {
            const box = this.countryBox(code);
            return {
              name: names[loc] || names.en,
              lat: box?.lat ?? 0,
              lon: box?.lon ?? 0,
              bbox: box?.bbox,
              kind: 'country' as const,
            };
          },
        });
      }
    }

    // cities
    const n = this.names.length;
    for (let i = 0; i < n; i++) {
      const a = this.nameN[i];
      const b = this.altN[i];
      let rank = 9;
      if (a === q || b === q) rank = 0;
      else if (a.startsWith(q) || (b && b.startsWith(q))) rank = 1;
      else if (q.length >= 3 && (a.includes(' ' + q) || (b && b.includes(' ' + q)))) rank = 2;
      if (rank === 9) continue;
      const idx = i;
      hits.push({
        rank,
        pop: this.pop[i],
        res: () => ({
          name: this.names[idx],
          detail: this.countryName(this.cc[idx], loc),
          lat: this.lat[idx],
          lon: this.lon[idx],
          kind: 'city' as const,
        }),
      });
    }
    hits.sort((x, y) => x.rank - y.rank || y.pop - x.pop);
    return hits.slice(0, limit).map((h) => h.res());
  }
}

let singleton: Promise<PlaceIndex> | null = null;

/** Builds the shared index lazily (≈0.3 s for 135 000 cities). */
export function getPlaceIndex(): Promise<PlaceIndex> {
  singleton ??= import('all-the-cities').then((m) => {
    const mod = m as unknown as { default?: City[] } & City[];
    return new PlaceIndex((mod.default ?? mod) as City[]);
  });
  return singleton;
}
