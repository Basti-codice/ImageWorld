// Thumbnail rendering pipelines (pure: file in → webp buffer out). No electron imports.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import type { ThumbSize } from '@shared/types';
import { decodeBmp } from './bmp';
import { getExifTool } from './metadata';
import { HEIF_EXT, RAW_EXT, SHARP_EXT, VIDEO_EXT, hex } from './util';

sharp.cache(false); // never keep files open/locked (Windows) or cache stale decodes

export interface RenderDeps {
  ffmpegPath: string | null;
  /** HEIC decoder (worker-backed in the app); falls back to in-process when missing */
  heic?: (file: string, size: ThumbSize) => Promise<Buffer>;
}

/** Resolves the ffmpeg-static binary; in the packaged app the binary lives in app.asar.unpacked. */
export function resolveFfmpegPath(): string | null {
  try {
    let p = (ffmpegStatic as unknown as string | null) ?? null;
    if (!p) return null;
    p = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

const orientationOps: Record<number, { rotate?: number; flip?: boolean; flop?: boolean }> = {
  1: {}, 2: { flop: true }, 3: { rotate: 180 }, 4: { flip: true }, 5: { rotate: 90 }, 6: { rotate: 90 }, 7: { rotate: 270 }, 8: { rotate: 270 },
};

async function encode(input: sharp.Sharp, size: ThumbSize): Promise<Buffer> {
  const cover = size !== 1600;
  return input
    .resize(size, size, cover ? { fit: 'cover' } : { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: cover ? 80 : 82, effort: 3 })
    .toBuffer();
}

async function fromBuffer(buf: Buffer | string, size: ThumbSize, forcedOrientation?: number): Promise<Buffer> {
  let img = sharp(buf, { failOn: 'none', limitInputPixels: false, sequentialRead: true });
  if (forcedOrientation && forcedOrientation > 1 && typeof buf !== 'string') {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    if (!meta.orientation || meta.orientation === 1) {
      const op = orientationOps[forcedOrientation] ?? {};
      if (op.flip) img = img.flip();
      if (op.flop) img = img.flop();
      if (op.rotate) img = img.rotate(op.rotate);
      return encode(img, size);
    }
  }
  return encode(img.rotate(), size);
}

async function renderRaw(file: string, size: ThumbSize): Promise<Buffer> {
  const et = getExifTool();
  let orientation: number | undefined;
  try {
    const t = (await et.readRaw(file, ['-n', '-Orientation'])) as unknown as { Orientation?: number };
    orientation = typeof t.Orientation === 'number' ? t.Orientation : undefined;
  } catch { /* ignore */ }
  let lastErr: unknown = new Error('no embedded preview');
  for (const tag of ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage'] as const) {
    try {
      const buf = await et.extractBinaryTagToBuffer(tag as 'JpgFromRaw', file);
      if (buf && buf.length > 500) return await fromBuffer(buf, size, orientation);
    } catch (e) {
      lastErr = e;
    }
  }
  // some DNG/TIFF-like raws are readable directly
  try { return await fromBuffer(file, size); } catch { /* ignore */ }
  throw lastErr;
}

function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, timeoutMs);
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

async function renderVideo(file: string, size: ThumbSize, ffmpeg: string | null): Promise<Buffer> {
  if (!ffmpeg) throw new Error('ffmpeg not available');
  const scale = "scale=w='min(1600,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease";
  for (const ss of ['1', '0']) {
    const frame = await runFfmpeg(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-ss', ss, '-i', file, '-frames:v', '1', '-vf', scale, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'],
      30_000,
    );
    if (frame.length > 100) return fromBuffer(frame, size); // ffmpeg already applied the rotation matrix
  }
  throw new Error('no video frame');
}

/** Renders a webp thumbnail for any supported media file. Throws when the file cannot be decoded. */
export async function renderThumb(file: string, ext: string, size: ThumbSize, deps: RenderDeps): Promise<Buffer> {
  if (VIDEO_EXT.has(ext)) return renderVideo(file, size, deps.ffmpegPath);
  if (RAW_EXT.has(ext)) return renderRaw(file, size);
  if (HEIF_EXT.has(ext)) {
    try {
      return await (deps.heic ? deps.heic(file, size) : (await import('./heic')).renderHeic(file, size));
    } catch (e) {
      // "heic" files that are really AVIF/JPEG inside – let libvips try
      try { return await fromBuffer(file, size); } catch { throw e; }
    }
  }
  if (ext === 'bmp') {
    const { data, width, height } = decodeBmp(await readFile(file));
    return encode(sharp(data, { raw: { width, height, channels: 4 } }), size);
  }
  if (SHARP_EXT.has(ext)) return fromBuffer(file, size);
  return fromBuffer(file, size);
}

/** Average colour from an 8x8 downscale. */
export async function averageColor(img: Buffer): Promise<string> {
  const { data } = await sharp(img, { failOn: 'none' }).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return hex(r / n, g / n, b / n);
}

let placeholderCache = new Map<number, Buffer>();
/** neutral grey tile shown when a thumbnail cannot be produced */
export async function placeholderImage(size: ThumbSize): Promise<Buffer> {
  const s = size === 1600 ? 512 : size;
  let b = placeholderCache.get(s);
  if (!b) {
    b = await sharp({ create: { width: s, height: s, channels: 3, background: '#2b2f38' } }).webp({ quality: 60 }).toBuffer();
    placeholderCache.set(s, b);
  }
  return b;
}
