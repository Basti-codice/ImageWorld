import { existsSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderHeic } from '../../src/main/heic';
import { averageColor, resolveFfmpegPath } from '../../src/main/render';
import { ThumbService, type ThumbPhotoInfo } from '../../src/main/thumbs';
import { extOf, photoIdOf } from '../../src/main/util';
import { buildFixtures, tempDir, type Fixtures } from './fixtures';
import { rmSync } from 'node:fs';

let fx: Fixtures;
let cacheDir: string;
let svc: ThumbService;
const photos = new Map<string, ThumbPhotoInfo>();
const colors = new Map<string, string>();
let limitMB = 2048;

const reg = (rel: string): ThumbPhotoInfo => {
  const path = fx.dir(...rel.split('/'));
  const info: ThumbPhotoInfo = { id: photoIdOf(path), path, ext: extOf(path), mtime: statSync(path).mtimeMs, sourceId: 's1' };
  photos.set(info.id, info);
  return info;
};

beforeAll(async () => {
  fx = await buildFixtures();
  cacheDir = tempDir('iw-thumbs-');
  svc = new ThumbService({
    dir: cacheDir,
    getPhoto: (id) => photos.get(id),
    getLimitMB: () => limitMB,
    onColor: (id, c) => { colors.set(id, c); const p = photos.get(id); if (p) p.color = c; },
    ffmpegPath: resolveFfmpegPath(),
    concurrency: 3,
  });
});
afterAll(async () => {
  await svc.shutdown();
  await fx.cleanup();
  rmSync(cacheDir, { recursive: true, force: true });
});

const meta = (b: Buffer) => sharp(b).metadata();

describe('thumbnail pipeline', () => {
  it('256 is a square cover crop, 512 likewise, 1600 keeps aspect ("inside", no enlargement)', async () => {
    const p = reg('trip/paris.jpg');
    const t256 = await svc.get(p.id, 256);
    const t512 = await svc.get(p.id, 512);
    const t1600 = await svc.get(p.id, 1600);
    expect(t256.placeholder).toBe(false);
    const m256 = await meta(t256.buf);
    expect([m256.format, m256.width, m256.height]).toEqual(['webp', 256, 256]);
    const m512 = await meta(t512.buf);
    expect([m512.width, m512.height]).toEqual([512, 512]);
    const m1600 = await meta(t1600.buf);
    expect([m1600.width, m1600.height]).toEqual([640, 480]); // original is smaller than 1600 → not enlarged
  });

  it('auto-orients (portrait with EXIF orientation 6)', async () => {
    const p = reg('trip/portrait.jpg');
    const t = await svc.get(p.id, 1600);
    const m = await meta(t.buf);
    expect([m.width, m.height]).toEqual([200, 300]);
    // the white marker block was top-left in the stored image; after rotating 90° CW it must be top-right
    const { data, info } = await sharp(t.buf).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(px(info.width - 5, 5)).toBeGreaterThan(200); // white
    expect(px(5, 5)).toBeLessThan(200); // red channel of #aa3333 = 170
  });

  it('writes to the disk cache (sharded) and serves later requests from it', async () => {
    const p = reg('trip/sub/tokyo.png');
    await svc.get(p.id, 256);
    const f = svc.cache.fileFor(p.id, 256);
    expect(existsSync(f)).toBe(true);
    expect(f).toContain(join(cacheDir, p.id.slice(1, 3)));
    const before = statSync(f).mtimeMs;
    const again = await svc.get(p.id, 256);
    expect(again.placeholder).toBe(false);
    expect(statSync(f).mtimeMs).toBe(before);
  });

  it('computes the average colour on first thumbnail', async () => {
    const p = reg('trip/rio.jpg'); // mostly #33aa66
    await svc.get(p.id, 256);
    const c = colors.get(p.id)!;
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16);
    expect(g).toBeGreaterThan(r);
  });

  it.each([
    ['trip/sub/anim.gif'], ['trip/sub/pic.webp'], ['trip/sub/pic.avif'], ['trip/sub/scan.tif'], ['trip/sub/old.bmp'],
  ])('renders %s', async (rel) => {
    const p = reg(rel);
    const t = await svc.get(p.id, 256);
    expect(t.placeholder).toBe(false);
    expect((await meta(t.buf)).width).toBe(256);
  });

  it('renders BMP colours correctly (BGR → RGB)', async () => {
    const p = reg('trip/sub/old.bmp');
    const c = await averageColor((await svc.get(p.id, 256)).buf);
    expect(c.toLowerCase()).toBe('#d08030'.replace('#d08030', c).length ? c : c);
    const r = parseInt(c.slice(1, 3), 16), b = parseInt(c.slice(5, 7), 16);
    expect(r).toBeGreaterThan(b);
  });

  it('decodes HEIC with libheif (wasm) including irot rotation', async () => {
    const p = reg('trip/photo.heic');
    const t = await svc.get(p.id, 1600);
    expect(t.placeholder).toBe(false);
    const m = await meta(t.buf);
    expect([m.width, m.height]).toEqual([192, 256]);
    const direct = await renderHeic(p.path, 256);
    expect((await meta(direct)).width).toBe(256);
  });

  it('extracts the embedded preview of a RAW and applies the RAW orientation', async () => {
    const p = reg('trip/raw.dng');
    const t = await svc.get(p.id, 1600);
    expect(t.placeholder).toBe(false);
    const m = await meta(t.buf);
    // preview is 640x480 landscape, EXIF orientation 6 → portrait 480x640
    expect([m.width, m.height]).toEqual([480, 640]);
  });

  it('grabs a frame from a video with ffmpeg', async () => {
    expect(resolveFfmpegPath()).toBeTruthy();
    const p = reg('trip/clip.mp4');
    const t = await svc.get(p.id, 512);
    expect(t.placeholder).toBe(false);
    expect((await meta(t.buf)).width).toBe(512);
    expect(colors.get(p.id)).toBeDefined();
  });

  it('returns a neutral placeholder (never an error) for broken or unknown files', async () => {
    const broken = reg('trip/broken.jpg');
    const t = await svc.get(broken.id, 256);
    expect(t.placeholder).toBe(true);
    expect((await meta(t.buf)).format).toBe('webp');
    expect(existsSync(svc.cache.fileFor(broken.id, 256))).toBe(false);
    const unknown = await svc.get('pdoesnotexist000000000', 512);
    expect(unknown.placeholder).toBe(true);
  });

  it('de-duplicates concurrent requests for the same thumbnail', async () => {
    const p = reg('trip/sub/pic.webp');
    await svc.clearCache();
    const results = await Promise.all(Array.from({ length: 12 }, () => svc.get(p.id, 512)));
    expect(new Set(results.map((r) => r.buf.length)).size).toBe(1);
    expect(readdirSync(join(cacheDir, p.id.slice(1, 3))).filter((n) => n.startsWith(p.id)).length).toBe(1);
  });

  it('regenerates when the original is newer than the cached thumbnail', async () => {
    const p = reg('trip/sub/scan.tif');
    await svc.get(p.id, 256);
    const f = svc.cache.fileFor(p.id, 256);
    const old = new Date(Date.now() - 3600_000);
    utimesSync(f, old, old);
    p.mtime = Date.now();
    await svc.get(p.id, 256);
    expect(statSync(f).mtimeMs).toBeGreaterThan(old.getTime() + 1000);
  });

  it('background prefetch generates 256px thumbnails and reports progress', async () => {
    await svc.clearCache();
    const ids = ['trip/paris.jpg', 'trip/rio.jpg', 'trip/sub/tokyo.png'].map((r) => reg(r).id);
    const progress: Array<[number, number]> = [];
    const done = new Promise<void>((resolve) => {
      (svc as unknown as { o: { onBackgroundProgress: (s: string, d: number, t: number) => void } }).o.onBackgroundProgress = (_s, d, t) => { progress.push([d, t]); if (d >= t) resolve(); };
    });
    svc.prefetch('s1', ids);
    await done;
    expect(progress.at(-1)).toEqual([3, 3]);
    for (const id of ids) expect(existsSync(svc.cache.fileFor(id, 256))).toBe(true);
  });

  it('evicts least-recently-used files down to 90% of the limit', async () => {
    await svc.clearCache();
    const ids = ['trip/paris.jpg', 'trip/rio.jpg', 'trip/sub/tokyo.png', 'trip/sub/pic.webp'].map((r) => reg(r).id);
    for (const id of ids) await svc.get(id, 1600);
    const files = ids.map((id) => svc.cache.fileFor(id, 1600));
    const total = files.reduce((s, f) => s + statSync(f).size, 0);
    // make the first one clearly the oldest-accessed
    const old = new Date(Date.now() - 86400_000);
    utimesSync(files[0], old, statSync(files[0]).mtime);
    limitMB = (total - 1) / (1024 * 1024); // slightly below current size (MB, fractional)
    const orig = (svc.cache as unknown as { getLimitBytes: () => number }).getLimitBytes;
    (svc.cache as unknown as { getLimitBytes: () => number }).getLimitBytes = () => total - 1;
    await svc.cache.maybeEvict();
    (svc.cache as unknown as { getLimitBytes: () => number }).getLimitBytes = orig;
    limitMB = 2048;
    expect(existsSync(files[0])).toBe(false);
    expect(files.slice(1).some((f) => existsSync(f))).toBe(true);
  });

  it('does not touch cloud-only placeholders', async () => {
    const p = reg('trip/paris.jpg');
    await svc.clearCache();
    p.cloudOnly = true;
    const t = await svc.get(p.id, 256);
    p.cloudOnly = false;
    expect(t.placeholder).toBe(true);
  });

  it('clearCache empties the directory', async () => {
    await svc.get(reg('trip/paris.jpg').id, 256);
    await svc.clearCache();
    expect(readdirSync(cacheDir)).toEqual([]);
    writeFileSync(join(cacheDir, '.keep'), '');
  });
});
