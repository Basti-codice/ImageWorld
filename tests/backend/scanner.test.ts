import { copyFileSync, mkdirSync, rmSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedMeta } from '../../src/main/metadata';
import { readMetadata } from '../../src/main/metadata';
import { readIndexFile } from '../../src/main/store';
import { photoIdOf, sourceIdOf, sourceKindOf } from '../../src/main/util';
import { makeEnv, idle, waitFor, type TestEnv } from './env';
import { buildFixtures, FIXTURE_MEDIA_COUNT, tempDir, type Fixtures } from './fixtures';

let fx: Fixtures;
const envs: TestEnv[] = [];
beforeAll(async () => { fx = await buildFixtures(); });
afterAll(async () => { await fx.cleanup(); });
afterEach(async () => { for (const e of envs.splice(0)) await e.close(); });

const mk = (...a: Parameters<typeof makeEnv>) => { const e = makeEnv(...a); envs.push(e); return e; };

describe('scanner (real fixtures, real exiftool)', () => {
  it('indexes all media in place, skipping hidden / recycle bin / non-media', async () => {
    const env = mk();
    await env.mgr.init();
    const src = await env.mgr.add(fx.root);
    expect(src).toMatchObject({ id: sourceIdOf(fx.root), kind: 'local', label: expect.any(String) });
    await waitFor(idle(env, src.id));

    const all = env.library.getAll();
    expect(all.length).toBe(FIXTURE_MEDIA_COUNT);
    expect(all.some((p) => p.path.includes('.hidden') || p.path.includes('RECYCLE') || p.name === 'notes.txt')).toBe(false);
    expect(env.mgr.list()[0]).toMatchObject({ status: 'idle', photoCount: FIXTURE_MEDIA_COUNT });
    expect(env.mgr.list()[0].lastScan).toBeGreaterThan(0);

    const by = (name: string) => all.find((p) => p.name === name)!;
    expect(by('paris.jpg')).toMatchObject({
      kind: 'photo', ext: 'jpg', width: 640, height: 480, takenAt: Date.UTC(2023, 4, 1, 14, 30), sortTime: Date.UTC(2023, 4, 1, 14, 30),
      geoSource: 'exif', camera: 'Apple iPhone 15 Pro', iso: 125, shutter: '1/250', favorite: false, rating: 0, tags: [], sourceId: src.id,
    });
    expect(by('paris.jpg').place).toMatchObject({ city: 'Paris', country: 'France', countryCode: 'FR' });
    expect(by('portrait.jpg')).toMatchObject({ width: 200, height: 300 });
    expect(by('portrait.jpg').place).toMatchObject({ countryCode: 'DE' });
    expect(by('rio.jpg').place).toMatchObject({ countryCode: 'BR' });
    expect(by('nullisland.jpg')).toMatchObject({ lat: null, lon: null, geoSource: null });
    expect(by('IMG_20190704_101500.jpg')).toMatchObject({ takenAt: Date.UTC(2019, 6, 4, 10, 15) });
    expect(by('clip.mp4')).toMatchObject({ kind: 'video', width: 320, height: 240, geoSource: 'exif' });
    expect(by('clip.mp4').duration).toBeGreaterThan(1.5);
    expect(by('clip.mp4').place?.countryCode).toBe('JP');
    expect(by('photo.heic')).toMatchObject({ ext: 'heic', width: 192, height: 256 });
    expect(by('raw.dng')).toMatchObject({ camera: 'Canon EOS R5' });
    // unreadable file is still listed (so the user sees it), with fallback values
    expect(by('broken.jpg').sortTime).toBeGreaterThan(0);
    // photo with no EXIF date: sortTime falls back to mtime
    expect(by('pic.webp').takenAt).toBeNull();
    expect(by('pic.webp').sortTime).toBe(by('pic.webp').mtime);

    // progress went through discovering → reading → done
    const phases = new Set(env.progress.map((p) => p.phase));
    expect(phases.has('discovering') && phases.has('reading') && phases.has('done')).toBe(true);
    // renderer receives everything via diffs
    await waitFor(() => env.diffs.reduce((n, d) => n + d.added.length, 0) === FIXTURE_MEDIA_COUNT);
  });

  it('is incremental: unchanged files are not re-read, changed/new/vanished files are picked up', async () => {
    const work = tempDir('iw-work-');
    try {
      mkdirSync(join(work, 'a'));
      for (const n of ['paris.jpg', 'rio.jpg', 'portrait.jpg']) copyFileSync(fx.dir('trip', n), join(work, 'a', n));
      let reads = 0;
      const readMeta = (f: string, e: string, k: 'photo' | 'video', m: number): Promise<ParsedMeta> => { reads++; return readMetadata(f, e, k, m); };
      const env = mk({ mgr: { readMeta } });
      await env.mgr.init();
      const src = await env.mgr.add(work);
      await waitFor(idle(env, src.id));
      expect(env.library.size).toBe(3);
      expect(reads).toBe(3);

      reads = 0;
      await env.mgr.rescan(src.id);
      await waitFor(() => env.mgr.list()[0].status === 'idle');
      expect(reads).toBe(0);

      // modify one (mtime change), add one, delete one
      const t = new Date(Date.now() + 5000);
      utimesSync(join(work, 'a', 'rio.jpg'), t, t);
      copyFileSync(fx.dir('trip', 'sub', 'tokyo.png'), join(work, 'a', 'tokyo.png'));
      rmSync(join(work, 'a', 'paris.jpg'));
      env.diffs.length = 0;
      await env.mgr.rescan(src.id);
      await waitFor(() => env.diffs.length > 0 && env.mgr.list()[0].status === 'idle');
      env.library.flush(true);
      expect(reads).toBe(2);
      expect(env.library.size).toBe(3);
      expect(env.library.get(photoIdOf(join(work, 'a', 'paris.jpg')))).toBeUndefined();
      const added = env.diffs.flatMap((d) => d.added.map((p) => p.name));
      const updated = env.diffs.flatMap((d) => d.updated.map((p) => p.name));
      const removed = env.diffs.flatMap((d) => d.removedIds);
      expect(added).toEqual(['tokyo.png']);
      expect(updated).toContain('rio.jpg');
      expect(removed).toEqual([photoIdOf(join(work, 'a', 'paris.jpg'))]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('persists the index: a restart serves cached photos immediately and re-reads nothing', async () => {
    const userData = tempDir('iw-ud-');
    try {
      const e1 = mk({ userData });
      await e1.mgr.init();
      const src = await e1.mgr.add(fx.root);
      await waitFor(idle(e1, src.id));
      const before = e1.library.getAll().sort((a, b) => a.id.localeCompare(b.id));
      // user state survives too
      e1.library.update([before[0].id], { favorite: true, rating: 3, tags: ['x'] });
      await e1.close();
      envs.splice(envs.indexOf(e1), 1);

      const idx = await readIndexFile(e1.paths.indexFile(src.id));
      expect(idx?.records.length).toBe(FIXTURE_MEDIA_COUNT);

      let reads = 0;
      const e2 = mk({ userData, mgr: { readMeta: (f, e, k, m) => { reads++; return readMetadata(f, e, k, m); } } });
      await e2.mgr.init(); // = what library:getAll awaits
      const cached = e2.library.getAll().sort((a, b) => a.id.localeCompare(b.id));
      expect(cached.length).toBe(FIXTURE_MEDIA_COUNT);
      const strip = (p: (typeof cached)[0]) => ({ ...p, favorite: undefined, rating: undefined, tags: undefined });
      expect(cached.map(strip)).toEqual(before.map(strip));
      expect(cached[0]).toMatchObject({ favorite: true, rating: 3, tags: ['x'] });
      expect(e2.mgr.list()[0]).toMatchObject({ photoCount: FIXTURE_MEDIA_COUNT, status: 'idle' });
      await e2.mgr.start();
      await waitFor(idle(e2, src.id));
      expect(reads).toBe(0);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('goes offline when the folder disappears (keeping cached photos) and re-syncs when it returns', async () => {
    const work = tempDir('iw-off-');
    const moved = work + '-moved';
    try {
      copyFileSync(fx.dir('trip', 'paris.jpg'), join(work, 'paris.jpg'));
      const env = mk();
      await env.mgr.init();
      const src = await env.mgr.add(work);
      await env.mgr.start();
      await waitFor(idle(env, src.id));
      expect(env.library.size).toBe(1);

      renameSync(work, moved);
      await waitFor(() => env.mgr.list()[0].status === 'offline');
      expect(env.library.size).toBe(1); // nothing is dropped while offline
      // explicit rescan of an offline source stays offline
      await env.mgr.rescan(src.id);
      expect(env.mgr.list()[0].status).toBe('offline');

      renameSync(moved, work);
      copyFileSync(fx.dir('trip', 'rio.jpg'), join(work, 'rio.jpg'));
      await waitFor(() => env.mgr.list()[0].status === 'idle' && env.library.size === 2, 15_000);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(moved, { recursive: true, force: true });
    }
  });

  it('missing folder at add() is rejected; nested sources are merged', async () => {
    const work = tempDir('iw-nest-');
    try {
      mkdirSync(join(work, 'child'));
      copyFileSync(fx.dir('trip', 'paris.jpg'), join(work, 'child', 'paris.jpg'));
      const env = mk();
      await env.mgr.init();
      await expect(env.mgr.add(join(work, 'nope'))).rejects.toThrow();
      const child = await env.mgr.add(join(work, 'child'));
      await waitFor(idle(env, child.id));
      const parent = await env.mgr.add(work);
      expect(parent.id).not.toBe(child.id);
      expect(env.mgr.list().map((s) => s.id)).toEqual([parent.id]); // child absorbed
      await waitFor(idle(env, parent.id));
      expect(env.library.size).toBe(1);
      expect(env.library.getAll()[0].sourceId).toBe(parent.id);
      // adding a folder inside an existing source returns the existing one
      const again = await env.mgr.add(join(work, 'child'));
      expect(again.id).toBe(parent.id);
      expect(env.mgr.list().length).toBe(1);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('removing a source drops its photos and its cache file', async () => {
    const env = mk();
    await env.mgr.init();
    const src = await env.mgr.add(fx.dir('trip', 'sub'));
    await waitFor(idle(env, src.id));
    expect(env.library.size).toBeGreaterThan(3);
    await env.mgr.persistIndex(src.id);
    await env.mgr.remove(src.id);
    expect(env.library.size).toBe(0);
    expect(env.mgr.list()).toEqual([]);
    expect(await readIndexFile(env.paths.indexFile(src.id))).toBeNull();
    env.library.flush(true);
    expect(env.diffs.flatMap((d) => d.removedIds).length).toBeGreaterThan(3);
  });
});

describe('source kind detection', () => {
  it('detects OneDrive, UNC and mapped network drives', () => {
    expect(sourceKindOf('C:\\Users\\me\\OneDrive\\Pictures')).toBe('onedrive');
    expect(sourceKindOf('C:\\Users\\me\\OneDrive - Contoso GmbH\\Bilder')).toBe('onedrive');
    expect(sourceKindOf('D:\\OneDrive')).toBe('onedrive');
    expect(sourceKindOf('\\\\nas\\photos\\2023')).toBe('network');
    expect(sourceKindOf('\\\\?\\UNC\\nas\\photos')).toBe('network');
    expect(sourceKindOf('\\\\?\\C:\\Pictures')).toBe('local');
    expect(sourceKindOf('Z:\\Fotos', new Set(['Z']))).toBe('network');
    expect(sourceKindOf('C:\\Pictures', new Set(['Z']))).toBe('local');
    expect(sourceKindOf('/home/me/Pictures')).toBe('local');
    expect(sourceKindOf('C:\\Users\\me\\MyOneDriveBackup\\x')).toBe('local');
  });
});

describe('scale', () => {
  it('indexes 20 000 files without blocking the event loop and with batched diffs', async () => {
    const work = tempDir('iw-scale-');
    try {
      const N = 20_000;
      for (let d = 0; d < 40; d++) {
        const sub = join(work, `d${d}`);
        mkdirSync(sub);
        for (let i = 0; i < N / 40; i++) writeFileSync(join(sub, `IMG_2023${String((i % 12) + 1).padStart(2, '0')}15_${i}.jpg`), '');
      }
      const readMeta = async (_f: string, _e: string, _k: 'photo' | 'video', mtime: number): Promise<ParsedMeta> => ({
        takenAt: mtime, width: 4000, height: 3000, lat: 48 + Math.random(), lon: 11 + Math.random(), alt: null, camera: 'Test Cam',
      });
      const env = mk({ mgr: { readMeta } });
      await env.mgr.init();
      // measure event-loop stalls while scanning
      let maxStall = 0;
      let last = Date.now();
      const timer = setInterval(() => { const n = Date.now(); maxStall = Math.max(maxStall, n - last - 20); last = n; }, 20);
      const t0 = Date.now();
      const src = await env.mgr.add(work);
      await waitFor(idle(env, src.id), 120_000, 100);
      clearInterval(timer);
      const ms = Date.now() - t0;
      expect(env.library.size).toBe(N);
      const batches = env.diffs.filter((d) => d.added.length).length;
      expect(batches).toBeGreaterThan(1);
      expect(batches).toBeLessThan(ms / 100 + 10); // ≤ ~1 per 250 ms window (+ chunking)
      expect(env.diffs.reduce((n, d) => n + d.added.length, 0)).toBe(N);
      console.log(`scale: ${N} files in ${ms} ms, ${batches} diff batches, max event-loop stall ${maxStall} ms`);
      expect(maxStall).toBeLessThan(1500);

      // second (incremental) scan is cheap
      const t1 = Date.now();
      await env.mgr.rescan(src.id);
      await waitFor(() => env.mgr.list()[0].status === 'idle');
      console.log(`scale: incremental rescan ${Date.now() - t1} ms`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 180_000);
});
