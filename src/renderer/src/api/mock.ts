/**
 * In-memory mock of window.api for plain-browser dev (`npm run dev:web`) and visual tests.
 * Generates ~2500 geotagged demo photos around real cities with procedurally drawn landscape thumbnails.
 */
import type { Album, AlbumDraft, GeocodeResult, ImageWorldApi, LibraryDiff, Photo, PhotoPatch, ScanProgress, Settings, Source } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

// ---------- deterministic rng ----------
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------- procedural thumbnails ----------
const cache = new Map<string, string>();
export function mockThumb(id: string, size = 256): string {
  const key = `${id}:${size > 600 ? 'l' : 's'}`;
  const hit = cache.get(key); if (hit) return hit;
  const r = mulberry32(hashStr(id));
  const hue = Math.floor(r() * 360), hue2 = (hue + 30 + r() * 60) % 360;
  const horizon = 0.5 + r() * 0.2;
  const hills = Array.from({ length: 3 }, (_, i) => {
    const y = horizon + i * 0.09 + r() * 0.04;
    const pts = Array.from({ length: 6 }, (_, k) => `${(k / 5) * 100},${(y + (r() - 0.5) * 0.14) * 100}`).join(' L');
    return `<path d="M0,100 L0,${y * 100} L${pts} L100,100 Z" fill="hsl(${(hue2 + i * 12) % 360} ${30 + i * 8}% ${28 - i * 7}%)"/>`;
  }).join('');
  const sun = `<circle cx="${20 + r() * 60}" cy="${horizon * 100 - 12 - r() * 12}" r="${4 + r() * 5}" fill="hsl(${hue2} 90% 85%)" opacity=".85"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 38%)"/><stop offset="${horizon}" stop-color="hsl(${hue2} 70% 72%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${sun}${hills}</svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

// ---------- demo data ----------
const CITIES: Array<[string, string, string, number, number, number]> = [
  // city, country, cc, lat, lon, weight
  ['München', 'Deutschland', 'DE', 48.137, 11.575, 30], ['Berlin', 'Deutschland', 'DE', 52.52, 13.405, 9], ['Hamburg', 'Deutschland', 'DE', 53.551, 9.993, 4],
  ['Garmisch-Partenkirchen', 'Deutschland', 'DE', 47.492, 11.095, 6], ['Rom', 'Italien', 'IT', 41.902, 12.496, 10], ['Venedig', 'Italien', 'IT', 45.44, 12.316, 5],
  ['Barcelona', 'Spanien', 'ES', 41.385, 2.173, 9], ['Lissabon', 'Portugal', 'PT', 38.722, -9.139, 6], ['Paris', 'Frankreich', 'FR', 48.857, 2.352, 8],
  ['London', 'Vereinigtes Königreich', 'GB', 51.507, -0.128, 6], ['Reykjavík', 'Island', 'IS', 64.147, -21.942, 7], ['Wien', 'Österreich', 'AT', 48.208, 16.373, 4],
  ['Zürich', 'Schweiz', 'CH', 47.377, 8.541, 3], ['Athen', 'Griechenland', 'GR', 37.984, 23.728, 4], ['Istanbul', 'Türkei', 'TR', 41.009, 28.978, 5],
  ['New York', 'USA', 'US', 40.713, -74.006, 10], ['San Francisco', 'USA', 'US', 37.775, -122.419, 6], ['Los Angeles', 'USA', 'US', 34.052, -118.244, 4],
  ['Vancouver', 'Kanada', 'CA', 49.283, -123.121, 3], ['Mexiko-Stadt', 'Mexiko', 'MX', 19.433, -99.133, 4], ['Rio de Janeiro', 'Brasilien', 'BR', -22.907, -43.173, 5],
  ['Buenos Aires', 'Argentinien', 'AR', -34.604, -58.382, 3], ['Kapstadt', 'Südafrika', 'ZA', -33.925, 18.424, 5], ['Marrakesch', 'Marokko', 'MA', 31.629, -7.981, 4],
  ['Dubai', 'Vereinigte Arabische Emirate', 'AE', 25.205, 55.27, 3], ['Tokio', 'Japan', 'JP', 35.676, 139.65, 12], ['Kyoto', 'Japan', 'JP', 35.012, 135.768, 6],
  ['Bangkok', 'Thailand', 'TH', 13.756, 100.502, 5], ['Singapur', 'Singapur', 'SG', 1.352, 103.82, 3], ['Bali', 'Indonesien', 'ID', -8.409, 115.189, 6],
  ['Sydney', 'Australien', 'AU', -33.869, 151.209, 6], ['Queenstown', 'Neuseeland', 'NZ', -45.031, 168.663, 4], ['Seoul', 'Südkorea', 'KR', 37.567, 126.978, 4],
];
const CAMERAS = ['Canon EOS R6', 'Sony α7 IV', 'Apple iPhone 15 Pro', 'Apple iPhone 13', 'Fujifilm X-T5', 'DJI Mavic 3'];
const LENSES = ['RF 24-70mm F2.8', 'FE 35mm F1.8', 'iPhone 15 Pro back camera 6.86mm f/1.78', 'XF 23mm F2', 'Hasselblad 24mm'];
const TAGS = ['Urlaub', 'Familie', 'Sonnenuntergang', 'Essen', 'Architektur', 'Natur', 'Freunde', 'Sport'];

function genPhotos(): Photo[] {
  const r = mulberry32(42);
  const total = CITIES.reduce((a, c) => a + c[5], 0);
  const out: Photo[] = [];
  // each city gets 1–3 trips at random dates, photos clustered within a trip
  const start = Date.UTC(2015, 0, 1), end = Date.UTC(2026, 9, 20);
  for (const [city, country, cc, lat, lon, w] of CITIES) {
    const trips = 1 + Math.floor(r() * (w > 8 ? 4 : 2));
    for (let t = 0; t < trips; t++) {
      const tripStart = start + r() * (end - start - 8 * 864e5);
      const n = Math.max(6, Math.round((w / total) * 2500 / trips * (0.6 + r() * 0.9) * 2.2));
      const cam = CAMERAS[Math.floor(r() * CAMERAS.length)];
      for (let i = 0; i < n; i++) {
        const day = Math.floor(r() * 7), hour = 7 + r() * 14;
        const takenAt = Math.floor(tripStart + day * 864e5 + hour * 36e5);
        const spread = 0.05 + r() * (w > 8 ? 0.12 : 0.06);
        const plat = lat + (r() - 0.5) * spread * (r() < 0.2 ? 2.5 : 1);
        const plon = lon + (r() - 0.5) * spread * 1.4;
        const portrait = r() < 0.28, video = r() < 0.05;
        const id = (hashStr(`${city}-${t}-${i}`).toString(16) + hashStr(`${i}-${t}-${city}`).toString(16)).padStart(16, '0').slice(0, 16);
        const tags: string[] = r() < 0.3 ? [TAGS[Math.floor(r() * TAGS.length)]] : [];
        out.push({
          id, path: `C:\\Users\\Demo\\Pictures\\${cc}\\${city}\\IMG_${String(1000 + i + t * 500)}.${video ? 'mp4' : 'jpg'}`, sourceId: 'src-demo', name: `IMG_${1000 + i + t * 500}.${video ? 'mp4' : 'jpg'}`,
          kind: video ? 'video' : 'photo', ext: video ? 'mp4' : 'jpg', size: Math.floor(2e6 + r() * 6e6), mtime: takenAt, takenAt, sortTime: takenAt,
          width: portrait ? 3024 : 4032, height: portrait ? 4032 : 3024, duration: video ? 5 + r() * 40 : undefined,
          lat: plat, lon: plon, geoSource: 'exif', place: { city, country, countryCode: cc },
          camera: cam, lens: LENSES[Math.floor(r() * LENSES.length)], iso: [100, 200, 400, 800][Math.floor(r() * 4)], aperture: [1.8, 2.8, 4, 5.6][Math.floor(r() * 4)],
          shutter: ['1/60', '1/125', '1/250', '1/500'][Math.floor(r() * 4)], focalLength: [24, 35, 50, 70][Math.floor(r() * 4)],
          favorite: r() < 0.06, rating: r() < 0.15 ? 3 + Math.floor(r() * 3) : 0, tags,
          color: `hsl(${Math.floor(r() * 360)} 40% 40%)`,
        });
      }
    }
  }
  // some photos without location
  for (let i = 0; i < 90; i++) {
    const takenAt = Math.floor(start + r() * (end - start));
    const id = (hashStr(`noloc-${i}`).toString(16) + 'abcdef0123456789').slice(0, 16);
    out.push({ id, path: `C:\\Users\\Demo\\Pictures\\Scans\\scan_${i}.jpg`, sourceId: 'src-demo', name: `scan_${i}.jpg`, kind: 'photo', ext: 'jpg', size: 3e6, mtime: takenAt, takenAt, sortTime: takenAt, width: 3000, height: 2000, lat: null, lon: null, geoSource: null, camera: 'Epson V600', favorite: false, rating: 0, tags: [] });
  }
  return out;
}

export function installMockApi(): void {
  let photos = genPhotos();
  let albums: Album[] = [];
  let settings: Settings = { ...DEFAULT_SETTINGS, onboardingDone: true };
  let sources: Source[] = [{ id: 'src-demo', path: 'C:\\Users\\Demo\\Pictures', label: 'Bilder', kind: 'local', status: 'idle', photoCount: photos.length, lastScan: Date.now() - 36e5 }, { id: 'src-od', path: 'C:\\Users\\Demo\\OneDrive\\Fotos', label: 'OneDrive – Fotos', kind: 'onedrive', status: 'idle', photoCount: 0, lastScan: Date.now() - 36e5 }];
  const subs = { lib: new Set<(d: LibraryDiff) => void>(), src: new Set<(s: Source[]) => void>(), prog: new Set<(p: ScanProgress) => void>(), alb: new Set<(a: Album[]) => void>(), set: new Set<(s: Settings) => void>() };
  const sub = <T,>(set: Set<(v: T) => void>, cb: (v: T) => void) => { set.add(cb); return () => { set.delete(cb); }; };
  const emitAlbums = () => subs.alb.forEach((cb) => cb(albums));
  const params = new URLSearchParams(location.search);
  if (params.get('empty')) { photos = []; sources = []; settings.onboardingDone = false; }
  if (params.get('albums')) {
    const sample = photos.filter((p) => p.place?.city === 'Tokio').slice(0, 24);
    albums = [{ id: 'a1', name: 'Japan 2024', createdAt: Date.now(), updatedAt: Date.now(), photoIds: sample.map((p) => p.id), coverPhotoId: sample[0]?.id, color: '#4b94ff' }];
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const api: ImageWorldApi = {
    platform: 'web',
    library: {
      getAll: async () => photos,
      onChanged: (cb) => sub(subs.lib, cb),
      update: async (ids, patch: PhotoPatch) => {
        photos = photos.map((p) => (ids.includes(p.id) ? { ...p, ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}), ...(patch.rating !== undefined ? { rating: patch.rating } : {}), ...(patch.tags ? { tags: patch.tags } : {}), ...(patch.location ? { lat: patch.location.lat, lon: patch.location.lon, geoSource: 'manual' as const } : {}) } : p));
      },
    },
    sources: {
      list: async () => sources,
      pickAndAdd: async () => { await sleep(200); return []; },
      add: async (path) => { const s: Source = { id: `src-${Date.now()}`, path, label: path.split(/[\\/]/).pop() || path, kind: 'local', status: 'idle', photoCount: 0, lastScan: Date.now() }; sources = [...sources, s]; subs.src.forEach((cb) => cb(sources)); return s; },
      remove: async (id) => { sources = sources.filter((s) => s.id !== id); subs.src.forEach((cb) => cb(sources)); },
      rescan: async () => {},
      onChanged: (cb) => sub(subs.src, cb),
      onProgress: (cb) => sub(subs.prog, cb),
      suggestions: async () => [{ label: 'OneDrive – Bilder', path: 'C:\\Users\\Demo\\OneDrive\\Bilder', kind: 'onedrive' }, { label: 'Bilder', path: 'C:\\Users\\Demo\\Pictures', kind: 'local' }],
    },
    albums: {
      list: async () => albums,
      create: async (d: AlbumDraft) => { const a: Album = { photoIds: [], ...d, id: `alb-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() }; albums = [...albums, a]; emitAlbums(); return a; },
      update: async (id, patch) => { albums = albums.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)); emitAlbums(); return albums.find((a) => a.id === id)!; },
      remove: async (id) => { albums = albums.filter((a) => a.id !== id); emitAlbums(); },
      onChanged: (cb) => sub(subs.alb, cb),
      exportToFolder: async () => ({ copied: 0, failed: 0, folder: null }),
    },
    settings: {
      get: async () => settings,
      set: async (p) => { settings = { ...settings, ...p }; subs.set.forEach((cb) => cb(settings)); return settings; },
      onChanged: (cb) => sub(subs.set, cb),
    },
    geocode: {
      search: async (q): Promise<GeocodeResult[]> => {
        const n = q.toLowerCase();
        return CITIES.filter((c) => c[0].toLowerCase().includes(n) || c[1].toLowerCase().includes(n)).slice(0, 6).map((c) => ({ name: c[0], detail: c[1], lat: c[3], lon: c[4], kind: 'city' as const, bbox: [c[4] - 0.15, c[3] - 0.1, c[4] + 0.15, c[3] + 0.1] as [number, number, number, number] }));
      },
    },
    shell: { pathForFile: (f) => (f as File & { path?: string }).path ?? f.name, showInFolder: async () => {}, openOriginal: async () => {}, clearThumbCache: async () => {} },
    window: { minimize() {}, toggleMaximize() {}, close() {}, isMaximized: async () => false, onMaximizedChange: () => () => {} },
  };
  window.api = api;
}
