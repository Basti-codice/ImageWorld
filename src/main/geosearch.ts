// Forward geocoding: Nominatim (online, throttled, cached) with offline fallback over the bundled city dataset.
import type { GeocodeResult, Settings } from '@shared/types';
import type { PlaceService } from './place-service';
import { warn } from './util';

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GeoSearchOptions {
  settings: () => Settings;
  places: PlaceService;
  locale: () => string;
  fetch: Fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface NominatimItem {
  name?: string; display_name: string; lat: string; lon: string; boundingbox?: string[];
  type?: string; category?: string; addresstype?: string;
}

export function mapNominatim(items: NominatimItem[]): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  for (const it of items) {
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const parts = it.display_name.split(',').map((s) => s.trim());
    const name = it.name || parts[0] || it.display_name;
    const rest = parts[0] === name ? parts.slice(1) : parts;
    const detail = rest.length > 3 ? [rest[0], ...rest.slice(-2)].join(', ') : rest.join(', ');
    const r: GeocodeResult = { name, lat, lon };
    if (detail) r.detail = detail;
    if (it.boundingbox?.length === 4) {
      const [s, n, w, e] = it.boundingbox.map(Number);
      if ([s, n, w, e].every(Number.isFinite)) r.bbox = [w, s, e, n];
    }
    const t = it.addresstype ?? it.type ?? '';
    if (t === 'country') r.kind = 'country';
    else if (/^(city|town|village|municipality|hamlet|suburb|borough|city_district|state|county|region)$/.test(t)) r.kind = 'city';
    else if (/^(house|road|building|residential|street|house_number|postcode)$/.test(t) || it.category === 'highway') r.kind = 'address';
    else r.kind = 'place';
    out.push(r);
  }
  return out;
}

export class GeoSearch {
  private cache = new Map<string, GeocodeResult[]>();
  private lastRequest = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private blockedUntil = 0;

  constructor(private readonly o: GeoSearchOptions) {}

  private lang(): string {
    const l = this.o.settings().language;
    return l === 'system' ? (this.o.locale() || 'en').slice(0, 2).toLowerCase() : l;
  }

  async search(query: string): Promise<GeocodeResult[]> {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    const lang = this.lang();
    const local = () => this.o.places.search(q, lang, 8).catch(() => [] as GeocodeResult[]);
    const now = (this.o.now ?? Date.now)();
    if (!this.o.settings().onlineSearch || now < this.blockedUntil) return local();
    const key = `${lang}|${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const res = await this.online(q, lang);
      if (res.length) {
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(key, res);
        return res;
      }
      return local();
    } catch (e) {
      // offline / blocked: don't hammer, use the offline dataset for a while
      this.blockedUntil = (this.o.now ?? Date.now)() + 30_000;
      warn('online geocoding unavailable, using offline search:', (e as Error).message);
      return local();
    }
  }

  private online(q: string, lang: string): Promise<GeocodeResult[]> {
    // strictly serialised, max 1 request per second (Nominatim usage policy)
    const run = async () => {
      const wait = this.lastRequest + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequest = Date.now();
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=8&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), this.o.timeoutMs ?? 6000);
      try {
        const r = await this.o.fetch(url, { headers: { 'User-Agent': 'ImageWorld/1.0', Accept: 'application/json' }, signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return mapNominatim((await r.json()) as NominatimItem[]);
      } finally {
        clearTimeout(t);
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p as Promise<GeocodeResult[]>;
  }
}
