// JSON persistence in the userData folder: atomic (tmp + rename), debounced, flushed on quit.
import { promises as fsp, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Album, Photo, Place, Settings, Source } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { sleep, warn, yieldToLoop } from './util';

export class Paths {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }
  get settings() { return join(this.root, 'settings.json'); }
  get sources() { return join(this.root, 'sources.json'); }
  get albums() { return join(this.root, 'albums.json'); }
  get userstate() { return join(this.root, 'userstate.json'); }
  get indexDir() { return join(this.root, 'index'); }
  indexFile(sourceId: string) { return join(this.indexDir, `${sourceId}.json`); }
  get thumbsDir() { return join(this.root, 'thumbs'); }
  get windowState() { return join(this.root, 'window.json'); }
}

/** Atomic write: tmp file in the same directory, then rename (with retries – Windows AV/indexers can briefly lock files). */
export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fsp.writeFile(tmp, data);
  await renameWithRetry(tmp, file);
}

async function renameWithRetry(tmp: string, file: string): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(30 * (i + 1));
    }
  }
  try {
    await fsp.copyFile(tmp, file);
    await fsp.rm(tmp, { force: true });
  } catch {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw lastErr;
  }
}

/** A single JSON document with debounced atomic saves. */
export class JsonFile<T> {
  value: T;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly fallback: () => T, private readonly delayMs = 400) {
    this.value = fallback();
  }

  /** synchronous on purpose: small files, needed before the window opens */
  load(merge?: (raw: unknown, fallback: T) => T): T {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      this.value = merge ? merge(raw, this.fallback()) : (raw as T);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn('could not read', this.file, e);
      this.value = this.fallback();
    }
    return this.value;
  }

  touch(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return this.chain;
    this.dirty = false;
    const json = JSON.stringify(this.value);
    this.chain = this.chain.then(() => atomicWrite(this.file, json)).catch((e) => warn('write failed', this.file, e));
    return this.chain;
  }
}

// ---------------------------------------------------------------------------------------------
// Typed stores
// ---------------------------------------------------------------------------------------------

export interface UserState {
  favorite?: boolean;
  rating?: number;
  tags?: string[];
  location?: { lat: number; lon: number };
}

export class Store {
  readonly settings: JsonFile<Settings>;
  readonly sources: JsonFile<Source[]>;
  readonly albums: JsonFile<Album[]>;
  readonly userstate: JsonFile<Record<string, UserState>>;

  constructor(readonly paths: Paths) {
    this.settings = new JsonFile(paths.settings, () => ({ ...DEFAULT_SETTINGS }));
    this.sources = new JsonFile(paths.sources, () => []);
    this.albums = new JsonFile(paths.albums, () => []);
    this.userstate = new JsonFile(paths.userstate, () => ({}), 800);
  }

  load(): void {
    this.settings.load((raw, fb) => ({ ...fb, ...(raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {}) }));
    this.sources.load((raw, fb) => (Array.isArray(raw) ? (raw as Source[]) : fb));
    this.albums.load((raw, fb) => (Array.isArray(raw) ? (raw as Album[]) : fb));
    this.userstate.load((raw, fb) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, UserState>) : fb));
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.settings.flush(), this.sources.flush(), this.albums.flush(), this.userstate.flush()]);
  }
}

// ---------------------------------------------------------------------------------------------
// Metadata cache: index/<sourceId>.json – valid JSON, one compact record per line so it can be
// written and parsed in slices without blocking the event loop (100k+ records).
// ---------------------------------------------------------------------------------------------

/** Persisted subset of a Photo (short keys keep 100k-file indexes small). */
export interface IndexRecord {
  p: string; // path
  s: number; // size
  m: number; // mtime
  t?: number | null; // takenAt
  w: number;
  h: number;
  d?: number; // duration
  la?: number | null;
  lo?: number | null;
  al?: number | null;
  pl?: Place;
  ca?: string;
  le?: string;
  iso?: number;
  ap?: number;
  sh?: string;
  fl?: number;
  co?: string;
  /** cloud-only placeholder that was skipped (metadata not read yet) */
  c?: 1;
  /** metadata read failed – do not retry until size/mtime change */
  x?: 1;
}

export function toRecord(p: Photo, geo?: { lat: number | null; lon: number | null; alt?: number | null; place?: Place }, flags?: { cloud?: boolean; failed?: boolean }): IndexRecord {
  const g = geo ?? { lat: p.lat, lon: p.lon, alt: p.alt, place: p.place };
  const r: IndexRecord = { p: p.path, s: p.size, m: p.mtime, w: p.width, h: p.height };
  if (p.takenAt != null) r.t = p.takenAt;
  if (p.duration != null) r.d = p.duration;
  if (g.lat != null && g.lon != null) { r.la = g.lat; r.lo = g.lon; if (g.alt != null) r.al = g.alt; }
  if (g.place) r.pl = g.place;
  if (p.camera) r.ca = p.camera;
  if (p.lens) r.le = p.lens;
  if (p.iso != null) r.iso = p.iso;
  if (p.aperture != null) r.ap = p.aperture;
  if (p.shutter) r.sh = p.shutter;
  if (p.focalLength != null) r.fl = p.focalLength;
  if (p.color) r.co = p.color;
  if (flags?.cloud) r.c = 1;
  if (flags?.failed) r.x = 1;
  return r;
}

export async function writeIndexFile(file: string, meta: { sourceId: string; root: string }, records: Iterable<IndexRecord>): Promise<void> {
  await fsp.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try {
    let buf: string[] = [JSON.stringify({ v: 1, sourceId: meta.sourceId, root: meta.root, records: 0 }).replace(/0\}$/, '[') + '\n'];
    let n = 0;
    let first = true;
    for (const rec of records) {
      buf.push((first ? '' : ',') + JSON.stringify(rec) + '\n');
      first = false;
      if (++n % 2000 === 0) {
        await fh.write(buf.join(''));
        buf = [];
        await yieldToLoop();
      }
    }
    buf.push(']}\n');
    await fh.write(buf.join(''));
  } finally {
    await fh.close();
  }
  await renameWithRetry(tmp, file);
}

export async function readIndexFile(file: string): Promise<{ sourceId: string; root: string; records: IndexRecord[] } | null> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn('index read failed', file, e);
    return null;
  }
  try {
    const lines = text.split('\n');
    const head = JSON.parse(lines[0] + ']}') as { sourceId: string; root: string };
    const records: IndexRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      let l = lines[i];
      if (!l || l === ']}') continue;
      if (l.charCodeAt(0) === 44 /* , */) l = l.slice(1);
      try { records.push(JSON.parse(l) as IndexRecord); } catch { /* torn line – skip */ }
      if (i % 4000 === 0) await yieldToLoop();
    }
    return { sourceId: head.sourceId, root: head.root, records };
  } catch (e) {
    warn('index corrupt, ignoring', file, e);
    return null;
  }
}
