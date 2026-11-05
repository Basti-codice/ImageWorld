import { afterAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';
import { GeoSearch, mapNominatim } from '../../src/main/geosearch';
import { PlaceService } from '../../src/main/place-service';

const places = new PlaceService();
afterAll(() => places.shutdown());

const nominatim = [
  { name: 'München', display_name: 'München, Bayern, Deutschland', lat: '48.1371079', lon: '11.5753822', boundingbox: ['47.9', '48.3', '11.3', '11.8'], addresstype: 'city', type: 'administrative' },
  { name: 'Marienplatz', display_name: 'Marienplatz, Altstadt, Altstadt-Lehel, München, Bayern, 80331, Deutschland', lat: '48.137', lon: '11.575', addresstype: 'road', category: 'highway' },
  { name: 'Deutschland', display_name: 'Deutschland', lat: '51', lon: '10', boundingbox: ['47.27', '55.06', '5.87', '15.04'], addresstype: 'country' },
];

function make(settings: Partial<Settings> = {}, fetchImpl?: ReturnType<typeof vi.fn>) {
  const fetch = fetchImpl ?? vi.fn(async () => ({ ok: true, status: 200, json: async () => nominatim }));
  const g = new GeoSearch({ settings: () => ({ ...DEFAULT_SETTINGS, ...settings }), places, locale: () => 'de-DE', fetch: fetch as never, timeoutMs: 300 });
  return { g, fetch };
}

describe('geocode search', () => {
  it('maps Nominatim results incl. bbox [w,s,e,n] and kind', () => {
    const r = mapNominatim(nominatim);
    expect(r[0]).toMatchObject({ name: 'München', detail: 'Bayern, Deutschland', lat: 48.1371079, lon: 11.5753822, bbox: [11.3, 47.9, 11.8, 48.3], kind: 'city' });
    expect(r[1].kind).toBe('address');
    expect(r[1].detail).toBe('Altstadt, 80331, Deutschland');
    expect(r[2]).toMatchObject({ kind: 'country', bbox: [5.87, 47.27, 15.04, 55.06] });
    expect(r[2].detail).toBeUndefined();
  });

  it('queries Nominatim with the required User-Agent and caches results', async () => {
    const { g, fetch } = make({ language: 'de' });
    const a = await g.search('München');
    expect(a.length).toBe(3);
    const [url, init] = (fetch.mock.calls[0] as unknown) as [string, { headers: Record<string, string> }];
    expect(url).toContain('nominatim.openstreetmap.org/search');
    expect(url).toContain('accept-language=de');
    expect(url).toContain(encodeURIComponent('München'));
    expect(init.headers['User-Agent']).toBe('ImageWorld/1.0');
    await g.search('münchen'); // case-insensitive cache hit
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never sends more than one request per second', async () => {
    const stamps: number[] = [];
    const fetch = vi.fn(async () => { stamps.push(Date.now()); return { ok: true, status: 200, json: async () => nominatim }; });
    const { g } = make({}, fetch);
    await Promise.all([g.search('aa1'), g.search('bb2'), g.search('cc3')]);
    expect(stamps.length).toBe(3);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(1000);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(1000);
  }, 15_000);

  it('falls back to the offline dataset when the network fails or times out', async () => {
    const { g } = make({ language: 'en' }, vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }));
    const r = await g.search('Berlin');
    expect(r.find((x) => x.name === 'Berlin')).toMatchObject({ kind: 'city', detail: 'Germany' });
    // aborts hanging requests
    const hang = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    const { g: g2 } = make({ language: 'en' }, hang as never);
    const r2 = await g2.search('Paris');
    expect(r2[0].name).toBe('Paris');
  });

  it('falls back on HTTP errors (e.g. blocked / 429) and uses the offline search when onlineSearch=false', async () => {
    const { g } = make({}, vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    expect((await g.search('Tokyo')).some((x) => x.name === 'Tokyo')).toBe(true);
    const { g: off, fetch } = make({ onlineSearch: false, language: 'de' });
    const r = await off.search('Deutschland');
    expect(fetch).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ name: 'Deutschland', kind: 'country' });
    expect(r[0].bbox).toBeDefined();
  });

  it('ignores too-short queries', async () => {
    const { g, fetch } = make();
    expect(await g.search(' a ')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
