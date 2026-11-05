import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Album, Photo } from '@shared/types';
import { albumPhotos, copyCollisionSafe, exportPhotos, pointInPolygon } from '../../src/main/export';
import { sanitizeSettings } from '../../src/main/settings';

const root = mkdtempSync(join(tmpdir(), 'iw-export-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const photo = (path: string, lat: number | null, lon: number | null, t = 0): Photo =>
  ({ id: path, path, lat, lon, sortTime: t } as unknown as Photo);

describe('album export', () => {
  it('copies originals into a new folder with collision-safe names and leaves sources untouched', async () => {
    const a = join(root, 'a'); const b = join(root, 'b');
    for (const d of [a, b]) require('node:fs').mkdirSync(d);
    writeFileSync(join(a, 'IMG_1.jpg'), 'first');
    writeFileSync(join(b, 'IMG_1.jpg'), 'second');
    const dest = join(root, 'out'); require('node:fs').mkdirSync(dest);
    const res = await exportPhotos([photo(join(a, 'IMG_1.jpg'), 0, 0), photo(join(b, 'IMG_1.jpg'), 0, 0), photo(join(a, 'missing.jpg'), 0, 0)], dest, 'Sommer: 2023/Italien?');
    expect(res.copied).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.folder).toBe(join(dest, 'Sommer_ 2023_Italien_'));
    expect(readdirSync(res.folder!).sort()).toEqual(['IMG_1 (2).jpg', 'IMG_1.jpg']);
    expect(readFileSync(join(res.folder!, 'IMG_1.jpg'), 'utf8')).toBe('first');
    expect(readFileSync(join(res.folder!, 'IMG_1 (2).jpg'), 'utf8')).toBe('second');
    expect(readFileSync(join(a, 'IMG_1.jpg'), 'utf8')).toBe('first');
    // exporting again never overwrites: new folder
    const again = await exportPhotos([photo(join(a, 'IMG_1.jpg'), 0, 0)], dest, 'Sommer: 2023/Italien?');
    expect(again.folder).toBe(join(dest, 'Sommer_ 2023_Italien_ (2)'));
    expect(existsSync(again.folder!)).toBe(true);
  });

  it('copyCollisionSafe never overwrites', async () => {
    const d = mkdtempSync(join(root, 'c-'));
    const src = join(root, 'a', 'IMG_1.jpg');
    const t = await Promise.all([copyCollisionSafe(src, d), copyCollisionSafe(src, d), copyCollisionSafe(src, d)]);
    expect(new Set(t).size).toBe(3);
  });

  it('evaluates live area albums against the library', () => {
    const square: Array<[number, number]> = [[10, 40], [20, 40], [20, 50], [10, 50]];
    expect(pointInPolygon(15, 45, square)).toBe(true);
    expect(pointInPolygon(25, 45, square)).toBe(false);
    const all = [photo('in', 45, 15, 100), photo('out', 0, 0, 100), photo('late', 45, 15, 999), photo('nogps', null, null)];
    const live: Album = { id: 'x', name: 'x', createdAt: 0, updatedAt: 0, photoIds: [], live: true, area: { polygon: square, from: 0, to: 500 } };
    expect(albumPhotos(live, all, () => undefined).map((p) => p.id)).toEqual(['in']);
    const snap: Album = { ...live, live: false, photoIds: ['out', 'gone'] };
    expect(albumPhotos(snap, all, (id) => all.find((p) => p.id === id)).map((p) => p.id)).toEqual(['out']);
  });
});

describe('settings validation', () => {
  it('keeps only known keys of the right type and clamps values', () => {
    expect(sanitizeSettings({ theme: 'light', language: 'xx' as never, thumbCacheMB: 5, bogus: 1, heatmap: 'yes' as never } as never)).toEqual({ theme: 'light', thumbCacheMB: 64 });
  });
});
