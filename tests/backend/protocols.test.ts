import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentTypeFor, fileHandler, parseFileUrl, parseRange, parseThumbUrl, serveFile, thumbHandler } from '../../src/main/protocols';
import { ThumbService } from '../../src/main/thumbs';

let dir: string;
const payload = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'iw-proto-'));
  writeFileSync(join(dir, 'clip.mp4'), payload);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const req = (url: string, headers: Record<string, string> = {}, method = 'GET') => new Request(url, { headers, method });

describe('range parsing', () => {
  it('handles the usual forms', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=50-10', 1000)).toBe('invalid');
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('serveFile (iw-file)', () => {
  const path = () => join(dir, 'clip.mp4');

  it('serves the whole file with Accept-Ranges and the right content type', async () => {
    const r = await serveFile(req('iw-file://p1'), path(), 'mp4');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await r.arrayBuffer()).equals(payload)).toBe(true);
  });

  it('serves 206 partial content for Range requests (video seeking)', async () => {
    const r = await serveFile(req('iw-file://p1', { Range: 'bytes=100-199' }), path(), 'mp4');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(r.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await r.arrayBuffer()).equals(payload.subarray(100, 200))).toBe(true);

    const open = await serveFile(req('iw-file://p1', { Range: 'bytes=990-' }), path(), 'mp4');
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect(Buffer.from(await open.arrayBuffer()).equals(payload.subarray(990))).toBe(true);

    const suffix = await serveFile(req('iw-file://p1', { Range: 'bytes=-10' }), path(), 'mp4');
    expect(Buffer.from(await suffix.arrayBuffer()).equals(payload.subarray(990))).toBe(true);
  });

  it('answers 416 for unsatisfiable ranges, 404 for missing files, HEAD without body', async () => {
    const bad = await serveFile(req('iw-file://p1', { Range: 'bytes=5000-6000' }), path(), 'mp4');
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */1000');
    expect((await serveFile(req('iw-file://p1'), join(dir, 'nope.mp4'), 'mp4')).status).toBe(404);
    const head = await serveFile(req('iw-file://p1', {}, 'HEAD'), path(), 'mp4');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('1000');
    expect(await head.text()).toBe('');
  });

  it('maps content types', () => {
    expect(contentTypeFor('JPG')).toBe('image/jpeg');
    expect(contentTypeFor('mov')).toBe('video/quicktime');
    expect(contentTypeFor('xyz')).toBe('application/octet-stream');
  });
});

describe('protocol URL handling', () => {
  it('parses iw-thumb and iw-file urls', () => {
    expect(parseThumbUrl('iw-thumb://pabc123/512')).toEqual({ id: 'pabc123', size: 512 });
    expect(parseThumbUrl('iw-thumb://pabc123/1600?x=1')).toEqual({ id: 'pabc123', size: 1600 });
    expect(parseThumbUrl('iw-thumb://pabc123/300')).toBeNull();
    expect(parseFileUrl('iw-file://pabc123')).toBe('pabc123');
    expect(parseFileUrl('iw-file://pabc123/')).toBe('pabc123');
  });

  it('thumb and file handlers work end to end', async () => {
    const img = join(dir, 'a.png');
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#445566' } }).png().toFile(img);
    const photos = new Map([['pimg', { id: 'pimg', path: img, ext: 'png', mtime: 1, sourceId: 's' }], ['pvid', { id: 'pvid', path: join(dir, 'clip.mp4'), ext: 'mp4', mtime: 1, sourceId: 's' }]]);
    const cache = mkdtempSync(join(tmpdir(), 'iw-proto-cache-'));
    const thumbs = new ThumbService({ dir: cache, getPhoto: (id) => photos.get(id), getLimitMB: () => 100, ffmpegPath: null, concurrency: 2 });
    try {
      const th = thumbHandler({ thumbs, getPhoto: (id) => photos.get(id) });
      const r = await th(req('iw-thumb://pimg/256'));
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/webp');
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
      const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      expect([m.format, m.width, m.height]).toEqual(['webp', 256, 256]);

      // unknown id / failing video (no ffmpeg) → placeholder with 200, never an error
      const ph = await th(req('iw-thumb://punknown/256'));
      expect(ph.status).toBe(200);
      expect(ph.headers.get('cache-control')).toBe('no-store');
      expect((await th(req('iw-thumb://pvid/512'))).status).toBe(200);
      expect((await th(req('iw-thumb://pimg/999'))).status).toBe(400);

      const fh = fileHandler({ thumbs, getPhoto: (id) => photos.get(id) });
      const part = await fh(req('iw-file://pvid', { Range: 'bytes=0-9' }));
      expect(part.status).toBe(206);
      expect((await fh(req('iw-file://pnone'))).status).toBe(404);
      const full = await fh(req('iw-file://pimg'));
      expect(full.headers.get('content-type')).toBe('image/png');
    } finally {
      await thumbs.shutdown();
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
