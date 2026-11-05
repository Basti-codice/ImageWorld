// Thumbnail service: disk cache (LRU by atime), in-flight de-dup, prioritised bounded work queue,
// background pre-generation of 256 px thumbnails, neutral placeholder on failure (never throws to callers).
import { promises as fsp } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ThumbSize } from '@shared/types';
import { averageColor, placeholderImage, renderThumb, type RenderDeps } from './render';
import { Semaphore, log, warn } from './util';

export interface ThumbPhotoInfo {
  id: string;
  path: string;
  ext: string;
  mtime: number;
  sourceId: string;
  color?: string;
  cloudOnly?: boolean;
}

export interface ThumbServiceOptions {
  dir: string;
  getPhoto: (id: string) => ThumbPhotoInfo | undefined;
  getLimitMB: () => number;
  onColor?: (id: string, color: string) => void;
  ffmpegPath: string | null;
  heicWorkerFile?: string;
  /** progress of background pre-generation per source */
  onBackgroundProgress?: (sourceId: string, done: number, total: number) => void;
  concurrency?: number;
}

export const THUMB_SIZES: ThumbSize[] = [256, 512, 1600];
export const isThumbSize = (n: number): n is ThumbSize => n === 256 || n === 512 || n === 1600;

// ---------------------------------------------------------------------------------------------
// HEIC worker runner
// ---------------------------------------------------------------------------------------------
class HeicRunner {
  private worker: Worker | null = null;
  private broken = false;
  private next = 1;
  private pending = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>();
  constructor(private readonly file?: string) {}

  private ensure(): Worker | null {
    if (this.broken || !this.file) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(this.file);
      w.on('message', (m: { id: number; buf?: ArrayBuffer; error?: string }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(Buffer.from(m.buf!));
      });
      const fail = (e: unknown) => {
        warn('heic worker failed', e);
        this.broken = true;
        this.worker = null;
        for (const p of this.pending.values()) p.reject(new Error('heic worker stopped'));
        this.pending.clear();
      };
      w.on('error', fail);
      w.on('exit', (c) => { if (this.worker === w) fail(`exit ${c}`); });
      w.unref();
      this.worker = w;
      return w;
    } catch (e) {
      warn('cannot start heic worker', e);
      this.broken = true;
      return null;
    }
  }

  async render(file: string, size: ThumbSize): Promise<Buffer> {
    const w = this.ensure();
    if (!w) return (await import('./heic')).renderHeic(file, size);
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const id = this.next++;
        this.pending.set(id, { resolve, reject });
        w.postMessage({ id, file, size });
      });
    } catch (e) {
      if (this.broken) return (await import('./heic')).renderHeic(file, size);
      throw e;
    }
  }

  async shutdown() {
    const w = this.worker;
    this.worker = null;
    this.broken = true;
    await w?.terminate().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Disk cache
// ---------------------------------------------------------------------------------------------
export class DiskCache {
  private knownDirs = new Set<string>();
  private bytesSinceSweep = 0;
  private writesSinceSweep = 0;
  private sweeping: Promise<void> | null = null;

  constructor(readonly dir: string, private readonly getLimitBytes: () => number) {}

  fileFor(id: string, size: number): string {
    return join(this.dir, id.slice(1, 3), `${id}_${size}.webp`);
  }

  /** returns the cached bytes if present and not older than the source file */
  async read(id: string, size: number, sourceMtime: number): Promise<Buffer | null> {
    const f = this.fileFor(id, size);
    try {
      const st = await fsp.stat(f);
      if (sourceMtime > 0 && st.mtimeMs + 2000 < sourceMtime) return null; // original changed after thumbnail was made
      const buf = await fsp.readFile(f);
      // LRU: bump atime only (keep mtime for staleness checks). Cheap, fire and forget, throttled by 10 min.
      if (Date.now() - st.atimeMs > 600_000) void fsp.utimes(f, new Date(), st.mtime).catch(() => undefined);
      return buf;
    } catch {
      return null;
    }
  }

  async exists(id: string, size: number, sourceMtime: number): Promise<boolean> {
    try {
      const st = await fsp.stat(this.fileFor(id, size));
      return !(sourceMtime > 0 && st.mtimeMs + 2000 < sourceMtime);
    } catch {
      return false;
    }
  }

  async write(id: string, size: number, buf: Buffer): Promise<void> {
    const f = this.fileFor(id, size);
    const d = join(this.dir, id.slice(1, 3));
    try {
      if (!this.knownDirs.has(d)) { await fsp.mkdir(d, { recursive: true }); this.knownDirs.add(d); }
      const tmp = `${f}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, f);
    } catch (e) {
      this.knownDirs.delete(d);
      warn('thumb write failed', e);
      return;
    }
    this.bytesSinceSweep += buf.length;
    if (++this.writesSinceSweep >= 400 || this.bytesSinceSweep > 128 * 1024 * 1024) void this.maybeEvict();
  }

  /** Full sweep: stat every cached file, delete least-recently-used ones until we are at 90 % of the limit. */
  maybeEvict(force = false): Promise<void> {
    if (this.sweeping) return this.sweeping;
    this.bytesSinceSweep = 0;
    this.writesSinceSweep = 0;
    this.sweeping = this.sweep(force).catch((e) => warn('thumb eviction failed', e)).finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async sweep(force: boolean): Promise<void> {
    const limit = this.getLimitBytes();
    const files: Array<{ f: string; size: number; at: number }> = [];
    let total = 0;
    let shards: string[] = [];
    try { shards = await fsp.readdir(this.dir); } catch { return; }
    for (const s of shards) {
      let names: string[];
      try { names = await fsp.readdir(join(this.dir, s)); } catch { continue; }
      for (let i = 0; i < names.length; i += 64) {
        await Promise.all(names.slice(i, i + 64).map(async (n) => {
          const f = join(this.dir, s, n);
          try {
            const st = await fsp.stat(f);
            total += st.size;
            files.push({ f, size: st.size, at: Math.max(st.atimeMs, st.mtimeMs) });
          } catch { /* vanished */ }
        }));
      }
    }
    if (!force && total <= limit) return;
    const target = limit * 0.9;
    files.sort((a, b) => a.at - b.at);
    let removed = 0;
    for (const x of files) {
      if (total <= target) break;
      try { await fsp.unlink(x.f); total -= x.size; removed++; } catch { /* ignore */ }
    }
    if (removed) log(`thumb cache: evicted ${removed} files`);
  }

  async clear(): Promise<void> {
    this.knownDirs.clear();
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.mkdir(this.dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------
interface Job {
  key: string;
  id: string;
  size: ThumbSize;
  priority: 0 | 1 | 2;
  waiters: number;
  started: boolean;
  cancelled: boolean;
  promise: Promise<Buffer>;
  resolve: (b: Buffer) => void;
  reject: (e: Error) => void;
  sourceId?: string;
}

export class ThumbService {
  readonly cache: DiskCache;
  private readonly slots: number;
  private active = 0;
  private bgActive = 0;
  private readonly p0: Job[] = [];
  private readonly p1: Job[] = [];
  private bg: Array<{ id: string; sourceId: string }> = [];
  private bgPos = 0;
  private readonly jobs = new Map<string, Job>();
  private readonly failed = new Map<string, number>(); // key → photo mtime at failure
  private readonly heavy = new Semaphore(2);
  private readonly heic: HeicRunner;
  private readonly deps: RenderDeps;
  private bgCounters = new Map<string, { total: number; done: number; lastEmit: number }>();
  private stopped = false;

  constructor(private readonly o: ThumbServiceOptions) {
    this.cache = new DiskCache(o.dir, () => Math.max(64, o.getLimitMB()) * 1024 * 1024);
    this.slots = o.concurrency ?? Math.max(2, Math.min(6, cpus().length - 1));
    this.heic = new HeicRunner(o.heicWorkerFile);
    this.deps = { ffmpegPath: o.ffmpegPath, heic: (f, s) => this.heic.render(f, s) };
    const t = setTimeout(() => void this.cache.maybeEvict(), 60_000);
    t.unref?.();
  }

  /** Returns webp bytes (cached, generated, or a placeholder). Never rejects. */
  async get(id: string, size: ThumbSize, opts: { signal?: AbortSignal } = {}): Promise<{ buf: Buffer; placeholder: boolean }> {
    const photo = this.o.getPhoto(id);
    if (!photo) return { buf: await placeholderImage(size), placeholder: true };
    const hit = await this.cache.read(id, size, photo.mtime);
    if (hit) return { buf: hit, placeholder: false };
    if (photo.cloudOnly) return { buf: await placeholderImage(size), placeholder: true };
    const key = `${id}_${size}`;
    if (this.failed.get(key) === photo.mtime) return { buf: await placeholderImage(size), placeholder: true };
    try {
      const buf = await this.enqueue(photo, size, size === 1600 ? 0 : 1, opts.signal);
      return { buf, placeholder: false };
    } catch {
      return { buf: await placeholderImage(size), placeholder: true };
    }
  }

  private enqueue(photo: ThumbPhotoInfo, size: ThumbSize, priority: 0 | 1 | 2, signal?: AbortSignal): Promise<Buffer> {
    const key = `${photo.id}_${size}`;
    let job = this.jobs.get(key);
    if (job) {
      // promote: a visible request outranks an already queued background job
      if (!job.started && priority < job.priority) {
        this.removeFromQueues(job);
        job.priority = priority;
        this.pushQueue(job);
      }
    } else {
      job = this.makeJob(photo, size, priority);
      this.pushQueue(job);
      this.pump();
    }
    job.waiters++;
    const j = job;
    if (signal) {
      const onAbort = () => {
        j.waiters--;
        if (j.waiters <= 0 && !j.started) {
          j.cancelled = true;
          this.removeFromQueues(j);
          this.jobs.delete(j.key);
          j.reject(new Error('cancelled'));
        }
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    return job.promise;
  }

  private pushQueue(job: Job) {
    (job.priority === 0 ? this.p0 : this.p1).push(job);
  }
  private removeFromQueues(job: Job) {
    for (const q of [this.p0, this.p1]) {
      const i = q.indexOf(job);
      if (i >= 0) q.splice(i, 1);
    }
  }

  /** queue 256 px thumbnails for background generation (low priority, skipped when already cached) */
  prefetch(sourceId: string, ids: string[]): void {
    if (!ids.length) return;
    for (const id of ids) this.bg.push({ id, sourceId });
    const c = this.bgCounters.get(sourceId) ?? { total: 0, done: 0, lastEmit: 0 };
    c.total += ids.length;
    this.bgCounters.set(sourceId, c);
    this.pump();
  }

  /** drop queued background work of a source (source removed) */
  cancelSource(sourceId: string): void {
    this.bg = this.bg.slice(this.bgPos).filter((b) => b.sourceId !== sourceId);
    this.bgPos = 0;
    this.bgCounters.delete(sourceId);
  }

  private pump(): void {
    if (this.stopped) return;
    while (this.active < this.slots) {
      let job: Job | undefined;
      // newest visible request first: the user is looking at what they scrolled to last
      while ((job = this.p0.pop() ?? this.p1.pop()) && job.cancelled) job = undefined;
      if (job) {
        this.start(job);
        continue;
      }
      if (this.bgActive >= Math.max(1, this.slots - 1)) break; // always keep one slot free for interactive requests
      const next = this.bg[this.bgPos++];
      if (!next) {
        if (this.bgPos > 0) { this.bg = []; this.bgPos = 0; }
        break;
      }
      if (this.bgPos > 50_000) { this.bg = this.bg.slice(this.bgPos); this.bgPos = 0; }
      this.startBackground(next.id, next.sourceId);
    }
  }

  private startBackground(id: string, sourceId: string): void {
    this.active++;
    this.bgActive++;
    void (async () => {
      try {
        const photo = this.o.getPhoto(id);
        if (!photo || photo.cloudOnly) return;
        const key = `${id}_256`;
        if (this.failed.get(key) === photo.mtime) return;
        if (this.jobs.has(key)) { await this.jobs.get(key)!.promise.catch(() => undefined); return; }
        if (await this.cache.exists(id, 256, photo.mtime)) {
          if (!photo.color) await this.colorFromCache(photo);
          return;
        }
        // go through enqueue so interactive requests for the same key de-dupe with us, but mark it as already running
        const job = this.makeJob(photo, 256, 2);
        job.started = true;
        await this.run(job, photo);
      } catch { /* logged in run */ } finally {
        this.active--;
        this.bgActive--;
        this.bgDone(sourceId);
        this.pump();
      }
    })();
  }

  private bgDone(sourceId: string) {
    const c = this.bgCounters.get(sourceId);
    if (!c) return;
    c.done++;
    const finished = c.done >= c.total;
    const now = Date.now();
    if (finished || now - c.lastEmit > 400) {
      c.lastEmit = now;
      this.o.onBackgroundProgress?.(sourceId, c.done, c.total);
    }
    if (finished) this.bgCounters.delete(sourceId);
  }

  private async colorFromCache(photo: ThumbPhotoInfo) {
    const buf = await this.cache.read(photo.id, 256, 0);
    if (buf) this.o.onColor?.(photo.id, await averageColor(buf));
  }

  private makeJob(photo: ThumbPhotoInfo, size: ThumbSize, priority: 0 | 1 | 2): Job {
    const key = `${photo.id}_${size}`;
    let resolve!: (b: Buffer) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Buffer>((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => undefined);
    const job: Job = { key, id: photo.id, size, priority, waiters: 0, started: false, cancelled: false, promise, resolve, reject, sourceId: photo.sourceId };
    this.jobs.set(key, job);
    return job;
  }

  private start(job: Job): void {
    const photo = this.o.getPhoto(job.id);
    job.started = true;
    this.active++;
    void (async () => {
      try {
        if (!photo) throw new Error('unknown photo');
        await this.run(job, photo);
      } catch (e) {
        job.reject(e as Error);
        this.jobs.delete(job.key);
      } finally {
        this.active--;
        this.pump();
      }
    })();
  }

  private async run(job: Job, photo: ThumbPhotoInfo): Promise<void> {
    const isHeavy = /^(heic|heif|cr2|cr3|nef|arw|dng|orf|rw2|raf|pef|srw|mp4|mov|m4v|avi|mkv|webm|3gp)$/.test(photo.ext);
    const release = isHeavy ? await this.heavy.acquire() : null;
    try {
      const buf = await renderThumb(photo.path, photo.ext, job.size, this.deps);
      await this.cache.write(photo.id, job.size, buf);
      job.resolve(buf);
      if (!photo.color) {
        try { this.o.onColor?.(photo.id, await averageColor(buf)); } catch { /* ignore */ }
      }
    } catch (e) {
      this.failed.set(job.key, photo.mtime);
      if (this.failed.size > 50_000) this.failed.clear();
      job.reject(e as Error);
      if (process.env.IMAGEWORLD_DEBUG === '1') warn('thumb failed', photo.path, (e as Error).message);
    } finally {
      release?.();
      this.jobs.delete(job.key);
    }
  }

  async clearCache(): Promise<void> {
    this.failed.clear();
    await this.cache.clear();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.bg = [];
    this.bgPos = 0;
    await this.heic.shutdown();
  }
}
