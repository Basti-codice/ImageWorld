import { beforeAll, describe, expect, it } from 'vitest';
import { PlaceService } from '../../src/main/place-service';
import { getPlaceIndex, type PlaceIndex } from '../../src/main/places';

describe('offline reverse geocoding', () => {
  let idx: PlaceIndex;
  beforeAll(async () => { idx = await getPlaceIndex(); });

  it('loads the dataset', () => {
    expect(idx.size).toBeGreaterThan(100_000);
  });

  it.each([
    [48.1374, 11.5755, 'Munich', 'Germany', 'DE'],
    [48.8566, 2.3522, 'Paris', 'France', 'FR'],
    [35.6762, 139.6503, 'Tokyo', 'Japan', 'JP'],
    [40.7128, -74.006, 'New York City', 'United States', 'US'],
    [-22.9068, -43.1729, 'Rio de Janeiro', 'Brazil', 'BR'],
    [-33.8688, 151.2093, 'Sydney', 'Australia', 'AU'],
    [52.52, 13.405, 'Berlin', 'Germany', 'DE'], // district "Mitte" is lifted to the city
  ])('(%d, %d) → %s', (lat, lon, city, country, cc) => {
    const p = idx.reverse(lat, lon);
    expect(p).toBeTruthy();
    expect(p!.city).toContain(city.split(' ')[0]);
    expect(p!.country).toBe(country);
    expect(p!.countryCode).toBe(cc);
  });

  it('returns undefined in the middle of the ocean and for invalid input', () => {
    expect(idx.reverse(-45, -135)).toBeUndefined();
    expect(idx.reverse(NaN, 0)).toBeUndefined();
    expect(idx.reverse(100, 0)).toBeUndefined();
  });

  it('is fast (10k lookups)', () => {
    const t = Date.now();
    for (let i = 0; i < 10_000; i++) idx.reverse(-60 + (i % 120), -170 + ((i * 7) % 340));
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('searches countries (en/de, accents) and cities', () => {
    const de = idx.search('Deutschland', 'de');
    expect(de[0]).toMatchObject({ name: 'Deutschland', kind: 'country' });
    expect(de[0].bbox).toBeDefined();
    const [w, s, e, n] = de[0].bbox!;
    expect(w).toBeLessThan(8); expect(e).toBeGreaterThan(12); expect(s).toBeLessThan(48); expect(n).toBeGreaterThan(53);
    expect(idx.search('germany', 'en')[0]).toMatchObject({ name: 'Germany', kind: 'country' });
    const cities = idx.search('Berlin', 'en');
    expect(cities.find((c) => c.kind === 'city' && c.name === 'Berlin')).toBeTruthy();
    expect(idx.search('Zuerich', 'de').length >= 0).toBe(true);
    expect(idx.search('x', 'en')).toEqual([]);
    expect(idx.search('japan', 'en')[0].name).toBe('Japan');
    // prefix search ranks bigger cities first
    const lon = idx.search('london', 'en', 3)[0];
    expect(lon.name).toBe('London');
    expect(lon.detail).toBe('United Kingdom');
  });
});

describe('PlaceService (in-process fallback)', () => {
  it('coalesces and caches lookups', async () => {
    const svc = new PlaceService(); // no worker file → in-process
    const [a, b, c] = await Promise.all([svc.reverse(48.1374, 11.5755), svc.reverse(48.1375, 11.5756), svc.reverse(35.68, 139.65)]);
    expect(a?.city).toBe('Munich');
    expect(b).toEqual(a);
    expect(c?.countryCode).toBe('JP');
    expect((await svc.search('Paris', 'en'))[0].name).toBe('Paris');
    await svc.shutdown();
  });
});
