// Small shared helpers for the main process (no electron imports – usable from tests and workers).
import { createHash } from 'node:crypto';
import { basename, extname, resolve, sep } from 'node:path';
import type { MediaKind, SourceKind } from '@shared/types';

export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'bmp', 'avif', 'heic', 'heif']);
export const RAW_EXT = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw']);
export const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp']);
export const HEIF_EXT = new Set(['heic', 'heif']);
/** formats libvips (sharp prebuilt) can decode directly */
export const SHARP_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif']);

export function extOf(file: string): string {
  return extname(file).slice(1).toLowerCase();
}

export function mediaKindOfExt(ext: string): MediaKind | null {
  if (IMAGE_EXT.has(ext) || RAW_EXT.has(ext)) return 'photo';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

export function mediaKindOf(file: string): MediaKind | null {
  return mediaKindOfExt(extOf(file));
}

export function isMediaFile(file: string): boolean {
  return mediaKindOf(file) !== null;
}

/** Windows paths are case-insensitive: keep the stored spelling but compare normalised. */
export const IS_WIN = process.platform === 'win32';

export function normalizePath(p: string): string {
  let r = resolve(p);
  // strip trailing separator (but not for drive roots like C:\ or /)
  while (r.length > 3 && (r.endsWith('\\') || r.endsWith('/'))) r = r.slice(0, -1);
  return r;
}

export function pathKey(p: string): string {
  const n = normalizePath(p);
  return IS_WIN ? n.toLowerCase() : n;
}

/** true if `child` is `parent` or lies inside it */
export function isInside(parent: string, child: string): boolean {
  const a = pathKey(parent);
  const b = pathKey(child);
  if (a === b) return true;
  const withSep = a.endsWith(sep) ? a : a + sep;
  return b.startsWith(withSep);
}

/**
 * Stable photo id: "p" + 20 hex chars of sha1(path). The leading letter guarantees the id is never an
 * all-numeric host name, which Chromium would canonicalise as an IPv4 address in iw-thumb://<id>/…
 */
export function photoIdOf(path: string): string {
  return 'p' + createHash('sha1').update(pathKey(path)).digest('hex').slice(0, 20);
}

export function sourceIdOf(path: string): string {
  return 's' + createHash('sha1').update(pathKey(path)).digest('hex').slice(0, 12);
}

export function sourceKindOf(path: string, mappedNetworkDrives: ReadonlySet<string> = new Set()): SourceKind {
  let p = path.replace(/\//g, '\\');
  if (/(^|\\)OneDrive[^\\]*(\\|$)/i.test(p)) return 'onedrive';
  if (/^\\\\\?\\UNC\\/i.test(p)) return 'network';
  if (p.startsWith('\\\\?\\')) p = p.slice(4);
  else if (p.startsWith('\\\\')) return 'network';
  const drive = /^([a-z]):/i.exec(p);
  if (drive && mappedNetworkDrives.has(drive[1].toUpperCase())) return 'network';
  return 'local';
}

export function labelOf(path: string): string {
  const b = basename(path);
  return b || path;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/** Runs `fn` over `items` with at most `limit` in flight. Stops early when `signal` aborts. */
export async function mapLimit<T>(items: AsyncIterable<T> | Iterable<T>, limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const running = new Set<Promise<void>>();
  for await (const item of items as AsyncIterable<T>) {
    if (signal?.aborted) break;
    const p: Promise<void> = fn(item).catch(() => undefined).finally(() => running.delete(p));
    running.add(p);
    if (running.size >= limit) await Promise.race(running);
  }
  await Promise.all(running);
}

export class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}

/** Trailing debounce with flush()/cancel(). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: NodeJS.Timeout | null = null;
  let lastArgs: A | null = null;
  const d = (...a: A) => {
    lastArgs = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; const args = lastArgs!; lastArgs = null; fn(...args); }, ms);
    t.unref?.();
  };
  d.flush = () => { if (t) { clearTimeout(t); t = null; const args = lastArgs!; lastArgs = null; fn(...args); } };
  d.cancel = () => { if (t) { clearTimeout(t); t = null; lastArgs = null; } };
  return d;
}

export function log(...a: unknown[]) {
  if (process.env.IMAGEWORLD_QUIET !== '1') console.log('[iw]', ...a);
}
export function warn(...a: unknown[]) {
  console.warn('[iw]', ...a);
}

/** "#rrggbb" from 0-255 channel values */
export function hex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
