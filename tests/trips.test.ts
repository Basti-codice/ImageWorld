import { describe, expect, it } from 'vitest';
import type { Photo } from '../src/shared/types';
import { detectTrips, countryName } from '../src/renderer/src/lib/trips';

const H = 36e5, D = 864e5;
let seq = 0;
function photo(t: number, lat: number | null, lon: number | null, city?: string, cc?: string, country?: string): Photo {
  const id = `p${seq++}`;
  return {
    id, path: `/x/${id}.jpg`, sourceId: 's', name: `${id}.jpg`, kind: 'photo', ext: 'jpg', size: 1, mtime: t, takenAt: t, sortTime: t,
    width: 10, height: 10, lat, lon, geoSource: lat == null ? null : 'exif',
    place: city ? { city, country: country ?? cc!, countryCode: cc! } : undefined,
    favorite: false, rating: 0, tags: [],
  };
}
const MUC = { lat: 48.137, lon: 11.575 }, TYO = { lat: 35.676, lon: 139.65 }, ROM = { lat: 41.902, lon: 12.496 }, VCE = { lat: 45.44, lon: 12.316 };
const t0 = Date.UTC(2023, 0, 1, 10);

/** photos every `step` ms starting at `start`, n of them, with a tiny jitter */
function burst(start: number, n: number, loc: { lat: number; lon: number }, city: string, cc: string, country: string, step = 2 * H) {
  return Array.from({ length: n }, (_, i) => photo(start + i * step, loc.lat + (i % 5) * 0.002, loc.lon + (i % 3) * 0.002, city, cc, country));
}

describe('detectTrips', () => {
  it('returns [] for empty / non-geotagged input', () => {
    expect(detectTrips([])).toEqual([]);
    expect(detectTrips([photo(t0, null, null), photo(t0 + H, null, null), photo(t0 + 2 * H, null, null)])).toEqual([]);
  });

  it('splits on time gaps > 36h and keeps smaller gaps together', () => {
    const a = burst(t0, 6, ROM, 'Rom', 'IT', 'Italien');
    const b = burst(t0 + 20 * H, 6, ROM, 'Rom', 'IT', 'Italien'); // gap ~ 8h -> same
    const c = burst(t0 + 5 * D, 6, ROM, 'Rom', 'IT', 'Italien'); // > 36h -> new trip
    const trips = detectTrips([...a, ...b, ...c], { lang: 'de' });
    expect(trips).toHaveLength(2);
    expect(trips[0].from).toBeGreaterThan(trips[1].from); // newest first
    expect(trips[1].photoIds).toHaveLength(12);
    expect(trips[0].photoIds).toHaveLength(6);
  });

  it('titles by dominant city, falls back to localised country for multi-city trips', () => {
    const one = detectTrips(burst(t0, 8, ROM, 'Rom', 'IT', 'Italien'), { lang: 'de' });
    expect(one[0].title).toBe('Rom');
    expect(one[0].countries).toEqual(['IT']);
    const multi = detectTrips([...burst(t0, 5, ROM, 'Rom', 'IT', 'Italien', 3 * H), ...burst(t0 + 2 * D, 5, VCE, 'Venedig', 'IT', 'Italien', 3 * H)], { lang: 'en' });
    expect(multi).toHaveLength(1);
    expect(multi[0].title).toBe('Italy');
  });

  it('country names follow the language', () => {
    expect(countryName('JP', 'de')).toBe('Japan');
    expect(countryName('DE', 'de')).toBe('Deutschland');
    expect(countryName('DE', 'en')).toBe('Germany');
  });

  it('infers home and marks away trips', () => {
    const photos: Photo[] = [];
    // home: a few photos every month for a year
    for (let m = 0; m < 12; m++) photos.push(...burst(Date.UTC(2023, m, 10, 9), 4, MUC, 'München', 'DE', 'Deutschland', 6 * H));
    // a Tokyo trip with many photos
    photos.push(...burst(Date.UTC(2023, 9, 1, 8), 40, TYO, 'Tokio', 'JP', 'Japan', 3 * H));
    const trips = detectTrips(photos, { lang: 'de' });
    const tokyo = trips.find((x) => x.title === 'Tokio')!;
    expect(tokyo.away).toBe(true);
    expect(tokyo.bbox[0]).toBeLessThan(tokyo.lon + 1e-9);
    expect(tokyo.bbox[2]).toBeGreaterThan(tokyo.lon - 1e-9);
    const munich = trips.filter((x) => x.title === 'München');
    expect(munich.length).toBeGreaterThan(0);
    expect(munich.every((x) => !x.away)).toBe(true);
  });

  it('merges tiny fragments at the edges of a trip', () => {
    const photos: Photo[] = [];
    for (let m = 0; m < 6; m++) photos.push(...burst(Date.UTC(2023, m, 10, 9), 5, MUC, 'München', 'DE', 'Deutschland', 4 * H));
    const start = Date.UTC(2023, 8, 1, 14);
    photos.push(photo(start - 5 * H, MUC.lat, MUC.lon, 'München', 'DE', 'Deutschland'), photo(start - 4.5 * H, MUC.lat, MUC.lon, 'München', 'DE', 'Deutschland'));
    photos.push(...burst(start, 20, TYO, 'Tokio', 'JP', 'Japan', 3 * H));
    const trips = detectTrips(photos, { lang: 'de' });
    const tokyo = trips.filter((x) => x.countries.includes('JP'));
    expect(tokyo).toHaveLength(1);
    expect(tokyo[0].photoIds).toHaveLength(22);
    expect(tokyo[0].away).toBe(true);
  });

  it('single photo / two photos do not produce trips, bbox never degenerate', () => {
    expect(detectTrips([photo(t0, 1, 1)])).toEqual([]);
    const same = Array.from({ length: 5 }, (_, i) => photo(t0 + i * H, 10, 20, 'X', 'XX', 'Nowhere'));
    const [trip] = detectTrips(same);
    expect(trip.bbox[2] - trip.bbox[0]).toBeGreaterThan(0.01);
    expect(trip.bbox[3] - trip.bbox[1]).toBeGreaterThan(0.01);
  });

  it('is memoised per input array', () => {
    const arr = burst(t0, 6, ROM, 'Rom', 'IT', 'Italien');
    expect(detectTrips(arr, { lang: 'de' })).toBe(detectTrips(arr, { lang: 'de' }));
  });

  it('handles 100k photos fast', () => {
    const photos: Photo[] = [];
    const places = [MUC, ROM, TYO, VCE];
    let t = Date.UTC(2015, 0, 1);
    for (let i = 0; i < 100_000; i++) {
      t += (i % 40 === 0 ? 3 * D : 40 * 60_000);
      const pl = places[Math.floor(i / 40) % 4];
      photos.push(photo(t, pl.lat + (i % 7) * 0.001, pl.lon + (i % 11) * 0.001, 'C', 'DE', 'Deutschland'));
    }
    const t1 = performance.now();
    const trips = detectTrips(photos, { lang: 'de' });
    const dt = performance.now() - t1;
    expect(trips.length).toBeGreaterThan(100);
    expect(dt).toBeLessThan(2500);
  });
});
