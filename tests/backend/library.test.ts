import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Place } from '@shared/types';
import { Library } from '../../src/main/library';
import { Paths, Store } from '../../src/main/store';
import { photoIdOf } from '../../src/main/util';
import { tempDir } from './fixtures';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const munich: Place = { city: 'Munich', country: 'Germany', countryCode: 'DE' };
const tokyo: Place = { city: 'Tokyo', country: 'Japan', countryCode: 'JP' };

function setup(dir = tempDir('iw-lib-')) {
  if (!dirs.includes(dir)) dirs.push(dir);
  const store = new Store(new Paths(dir));
  store.load();
  const lib = new Library(store, async (lat) => (lat > 40 ? munich : tokyo), 10);
  return { dir, store, lib };
}

const file = (name: string) => ({ path: `/photos/${name}`, size: 100, mtime: 1_600_000_000_000 });
const meta = (extra: object = {}) => ({ takenAt: Date.UTC(2023, 0, 1), width: 400, height: 300, lat: 48.1, lon: 11.5, alt: 500, ...extra }) as never;

describe('library + user state', () => {
  it('ingests photos with sensible defaults and sortTime fallback', () => {
    const { lib } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    expect(a).toMatchObject({ id: photoIdOf('/photos/a.jpg'), name: 'a.jpg', ext: 'jpg', kind: 'photo', favorite: false, rating: 0, tags: [], geoSource: 'exif', sortTime: Date.UTC(2023, 0, 1) });
    const b = lib.ingest('s1', file('b.mp4'), meta({ takenAt: null, lat: null, lon: null }), undefined);
    expect(b).toMatchObject({ kind: 'video', takenAt: null, sortTime: 1_600_000_000_000, geoSource: null, lat: null });
    expect(b.place).toBeUndefined();
  });

  it('merges favorite / rating / tags and persists them', async () => {
    const { dir, store, lib } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    lib.update([a.id], { favorite: true, rating: 4, tags: ['trip', ' summer ', 'trip', ''] });
    expect(lib.get(a.id)).toMatchObject({ favorite: true, rating: 4, tags: ['trip', 'summer'] });
    lib.update([a.id], { rating: 99 });
    expect(lib.get(a.id)!.rating).toBe(5);
    await store.userstate.flush();

    // fresh process: user state is merged into re-ingested photos
    const s2 = setup(dir);
    const again = s2.lib.ingest('s1', file('a.jpg'), meta(), munich);
    expect(again).toMatchObject({ favorite: true, rating: 5, tags: ['trip', 'summer'] });

    // clearing everything removes the entry (no unbounded growth)
    s2.lib.update([a.id], { favorite: false, rating: 0, tags: [] });
    expect(s2.store.userstate.value[a.id]).toBeUndefined();
  });

  it('manual location overrides EXIF and can be removed again', async () => {
    const { lib, store } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    lib.update([a.id], { location: { lat: 35.68, lon: 139.65 } });
    expect(lib.get(a.id)).toMatchObject({ lat: 35.68, lon: 139.65, geoSource: 'manual', alt: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(lib.get(a.id)!.place).toEqual(tokyo); // re-geocoded for the new position
    expect(store.userstate.value[a.id].location).toEqual({ lat: 35.68, lon: 139.65 });
    // persisted index keeps the original EXIF position
    const rec = Array.from(lib.records('s1'))[0];
    expect(rec).toMatchObject({ la: 48.1, lo: 11.5, al: 500, pl: munich });

    lib.update([a.id], { location: null });
    expect(lib.get(a.id)).toMatchObject({ lat: 48.1, lon: 11.5, alt: 500, geoSource: 'exif', place: munich });
    expect(store.userstate.value[a.id]).toBeUndefined();
  });

  it('manual location on a photo without GPS, and removal restores "no location"', () => {
    const { lib } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta({ lat: null, lon: null, alt: null }), undefined);
    lib.update([a.id], { location: { lat: 50, lon: 8 } });
    expect(lib.get(a.id)).toMatchObject({ lat: 50, lon: 8, geoSource: 'manual' });
    lib.update([a.id], { location: null });
    expect(lib.get(a.id)).toMatchObject({ lat: null, lon: null, geoSource: null });
    expect(lib.get(a.id)!.place).toBeUndefined();
  });

  it('manual location survives re-indexing of a changed file', async () => {
    const { lib } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    lib.update([a.id], { location: { lat: 35.68, lon: 139.65 } });
    const re = lib.ingest('s1', { ...file('a.jpg'), size: 200 }, meta(), munich);
    expect(re).toMatchObject({ lat: 35.68, geoSource: 'manual', size: 200 });
    lib.update([a.id], { location: null });
    expect(lib.get(a.id)).toMatchObject({ lat: 48.1, geoSource: 'exif' });
  });

  it('ignores unknown ids and never throws', () => {
    const { lib } = setup();
    expect(() => lib.update(['nope'], { favorite: true })).not.toThrow();
  });

  it('batches diffs: add+update in one window = one added entry; add+remove = nothing', async () => {
    const { lib } = setup();
    const diffs: Array<{ a: number; u: number; r: number }> = [];
    lib.onDiff((d) => diffs.push({ a: d.added.length, u: d.updated.length, r: d.removedIds.length }));
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    lib.update([a.id], { favorite: true });
    const b = lib.ingest('s1', file('b.jpg'), meta(), munich);
    lib.remove([b.id]);
    await new Promise((r) => setTimeout(r, 60));
    expect(diffs).toEqual([{ a: 1, u: 0, r: 0 }]);
    // later update of an existing photo → "updated"
    lib.update([a.id], { rating: 3 });
    await new Promise((r) => setTimeout(r, 60));
    expect(diffs[1]).toEqual({ a: 0, u: 1, r: 0 });
    lib.remove([a.id]);
    await new Promise((r) => setTimeout(r, 60));
    expect(diffs[2]).toEqual({ a: 0, u: 0, r: 1 });
  });

  it('colour updates are throttled but delivered (and flush(true) forces them)', async () => {
    const { lib } = setup();
    const a = lib.ingest('s1', file('a.jpg'), meta(), munich);
    lib.flush();
    const diffs: number[] = [];
    lib.onDiff((d) => diffs.push(d.updated.length));
    lib.setColor(a.id, '#112233');
    lib.setColor(a.id, '#112233');
    lib.flush(true);
    expect(diffs).toEqual([1]);
    expect(lib.get(a.id)!.color).toBe('#112233');
  });

  it('chunks huge diffs for IPC', () => {
    const { lib } = setup();
    for (let i = 0; i < 7000; i++) lib.ingest('s1', file(`p${i}.jpg`), meta(), munich);
    const sizes: number[] = [];
    lib.onDiff((d) => sizes.push(d.added.length));
    lib.flush(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(7000);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3000);
  });
});
