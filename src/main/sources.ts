// Source manager: add/remove/rescan, status (idle/scanning/offline/error), watchers, offline re-sync, suggestions.
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ScanProgress, Settings, Source, SourceKind } from '@shared/types';
import type { CloudChecker } from './cloud';
import type { Library } from './library';
import type { PlaceService } from './place-service';
import { applyFileChanges, ScanAborted, scanSource, type ScanDeps } from './scanner';
import { readIndexFile, writeIndexFile, type Store } from './store';
import type { ThumbService } from './thumbs';
import { debounce, isInside, labelOf, log, normalizePath, pathKey, sourceIdOf, sourceKindOf, warn } from './util';
import { startWatcher, type SourceWatcher } from './watcher';

export interface SourceManagerDeps {
  store: Store;
  library: Library;
  places: PlaceService;
  thumbs?: ThumbService;
  cloud: CloudChecker;
  settings: () => Settings;
  picturesDir?: () => string | undefined;
  onSourcesChanged: (list: Source[]) => void;
  onProgress: (p: ScanProgress) => void;
  readMeta?: ScanDeps['readMeta'];
  probeIntervalMs?: number;
  watch?: boolean;
}

interface Runtime {
  abort?: AbortController;
  running: boolean;
  again: boolean;
  watcher?: SourceWatcher;
  watcherStarting?: boolean;
  persistChain: Promise<void>;
  persistSoon: () => void;
  changeQueue: Promise<void>;
}

const OFFLINE_CODES = new Set(['ENOENT', 'ENOTDIR', 'ENXIO', 'EIO', 'ETIMEDOUT', 'ENOTCONN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EBUSY', 'ECONNRESET', 'UNKNOWN', 'ENODEV']);

export class SourceManager {
  private rt = new Map<string, Runtime>();
  private mapped = new Set<string>();
  private probeTimer: NodeJS.Timeout | null = null;
  private emitSources = debounce(() => this.deps.onSourcesChanged(this.list()), 200);
  private stopped = false;
  /** resolves once all cached indexes are loaded into the library */
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SourceManagerDeps) {}

  private get sources(): Source[] { return this.deps.store.sources.value; }
  private persistSources() { this.deps.store.sources.touch(); }

  list(): Source[] {
    return this.sources.map((s) => ({ ...s, photoCount: this.deps.library.countOfSource(s.id) }));
  }

  private runtime(id: string): Runtime {
    let r = this.rt.get(id);
    if (!r) {
      r = { running: false, again: false, persistChain: Promise.resolve(), changeQueue: Promise.resolve(), persistSoon: () => undefined };
      const rr = r;
      rr.persistSoon = debounce(() => { void this.persistIndex(id); }, 4000);
      this.rt.set(id, rr);
    }
    return r;
  }

  // ---------------------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------------------
  /** Loads persisted indexes (fast path for the first getAll). */
  init(): Promise<void> {
    for (const s of this.sources) { s.status = 'idle'; delete s.error; }
    this.ready = (async () => {
      this.mapped = await detectMappedDrives();
      for (const s of this.sources) {
        s.kind = sourceKindOf(s.path, this.mapped);
        const idx = await readIndexFile(this.deps.store.paths.indexFile(s.id));
        if (idx) this.deps.library.loadRecords(s.id, idx.records);
        s.photoCount = this.deps.library.countOfSource(s.id);
      }
    })();
    return this.ready;
  }

  /** Starts incremental scans, watchers and the offline probe. */
  async start(): Promise<void> {
    await this.ready;
    for (const s of this.sources) void this.scan(s.id);
    const every = this.deps.probeIntervalMs ?? 20_000;
    this.probeTimer = setInterval(() => void this.probe(), every);
    this.probeTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.emitSources.cancel();
    for (const r of this.rt.values()) r.abort?.abort();
    await Promise.all(Array.from(this.rt.values()).map((r) => r.watcher?.close()));
    this.deps.library.flush(true);
    await Promise.all(this.sources.map((s) => this.persistIndex(s.id)));
  }

  // ---------------------------------------------------------------------------------------
  // public operations
  // ---------------------------------------------------------------------------------------
  async add(path: string): Promise<Source> {
    const root = normalizePath(path);
    let st;
    try { st = await fsp.stat(root); } catch { throw new Error(`Folder not found: ${root}`); }
    if (!st.isDirectory()) throw new Error(`Not a folder: ${root}`);
    const existing = this.sources.find((s) => pathKey(s.path) === pathKey(root));
    if (existing) { void this.scan(existing.id); return { ...existing, photoCount: this.deps.library.countOfSource(existing.id) }; }
    // a folder inside an already indexed one adds nothing new
    const parent = this.sources.find((s) => isInside(s.path, root));
    if (parent) { void this.scan(parent.id); return { ...parent, photoCount: this.deps.library.countOfSource(parent.id) }; }
    // a new parent swallows the sources nested inside it
    for (const child of this.sources.filter((s) => isInside(root, s.path))) await this.remove(child.id);

    const src: Source = {
      id: sourceIdOf(root), path: root, label: labelOf(root), kind: sourceKindOf(root, this.mapped),
      status: 'idle', photoCount: 0, lastScan: null,
    };
    this.sources.push(src);
    this.persistSources();
    this.emitSources();
    void this.scan(src.id);
    return { ...src };
  }

  async remove(id: string): Promise<void> {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i < 0) return;
    const r = this.rt.get(id);
    r?.abort?.abort();
    await r?.watcher?.close();
    this.rt.delete(id);
    this.sources.splice(i, 1);
    this.deps.thumbs?.cancelSource(id);
    this.deps.library.removeSource(id);
    this.persistSources();
    await fsp.rm(this.deps.store.paths.indexFile(id), { force: true }).catch(() => undefined);
    this.deps.onProgress({ sourceId: id, phase: 'done', done: 0, total: 0 });
    this.emitSources();
  }

  async rescan(id?: string): Promise<void> {
    const ids = id ? [id] : this.sources.map((s) => s.id);
    await Promise.all(ids.map((x) => this.scan(x)));
  }

  /** Scans one source (coalesces concurrent requests). Resolves when the scan finished. */
  async scan(id: string): Promise<void> {
    const src = this.sources.find((s) => s.id === id);
    if (!src || this.stopped) return;
    const rt = this.runtime(id);
    if (rt.running) { rt.again = true; return; }
    rt.running = true;
    try {
      do {
        rt.again = false;
        await this.scanOnce(src, rt);
      } while (rt.again && !this.stopped && this.sources.includes(src));
    } finally {
      rt.running = false;
    }
  }

  private scanDeps(): ScanDeps {
    return {
      library: this.deps.library,
      places: this.deps.places,
      settings: this.deps.settings,
      cloud: this.deps.cloud,
      thumbs: this.deps.thumbs,
      readMeta: this.deps.readMeta,
      progress: (p) => this.deps.onProgress(p),
      persist: (sid) => this.runtime(sid).persistSoon(),
    };
  }

  private async scanOnce(src: Source, rt: Runtime): Promise<void> {
    const ac = new AbortController();
    rt.abort = ac;
    src.status = 'scanning';
    delete src.error;
    this.emitSources();
    const ticker = setInterval(() => this.emitSources(), 600);
    try {
      const sum = await scanSource(this.scanDeps(), src, ac.signal);
      src.status = 'idle';
      src.lastScan = Date.now();
      log(`scan ${src.label}: ${sum.found} files, +${sum.added} ~${sum.updated} -${sum.removed}`);
      void this.ensureWatcher(src);
      // thumbnails phase is reported by the thumb service; if nothing is queued the scan is simply done
      this.deps.onProgress({ sourceId: src.id, phase: 'done', done: sum.found, total: sum.found });
    } catch (e) {
      if (e instanceof ScanAborted || ac.signal.aborted) return;
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (OFFLINE_CODES.has(code)) {
        src.status = 'offline';
        await rt.watcher?.close(); rt.watcher = undefined;
      } else {
        src.status = 'error';
        src.error = (e as Error).message;
        warn('scan failed', src.path, e);
      }
      this.deps.onProgress({ sourceId: src.id, phase: 'done', done: 0, total: 0 });
    } finally {
      clearInterval(ticker);
      rt.abort = undefined;
      src.photoCount = this.deps.library.countOfSource(src.id);
      this.persistSources();
      this.emitSources();
      await this.persistIndex(src.id);
    }
  }

  // ---------------------------------------------------------------------------------------
  // watching + offline detection
  // ---------------------------------------------------------------------------------------
  private async ensureWatcher(src: Source) {
    if (this.deps.watch === false || this.stopped) return;
    const rt = this.runtime(src.id);
    if (rt.watcher || rt.watcherStarting) return;
    rt.watcherStarting = true;
    try {
      // polling a huge network share would hammer it: those are re-synced by the periodic probe instead
      const usePolling = src.kind === 'network';
      if (usePolling && this.deps.library.countOfSource(src.id) > 30_000) return;
      const w = await startWatcher(src, (changes) => {
        rt.changeQueue = rt.changeQueue.then(async () => {
          try { await applyFileChanges(this.scanDeps(), src, changes); } catch (e) { warn('apply changes failed', e); }
          src.photoCount = this.deps.library.countOfSource(src.id);
          this.emitSources();
        });
      }, { usePolling });
      if (this.stopped || !this.sources.includes(src)) { await w.close(); return; }
      rt.watcher = w;
    } catch (e) {
      warn('watcher failed', src.path, e);
    } finally {
      rt.watcherStarting = false;
    }
  }

  private async probe(): Promise<void> {
    for (const src of this.sources.slice()) {
      const rt = this.runtime(src.id);
      if (rt.running) continue;
      const ok = await dirReachable(src.path, 6000);
      if (ok && (src.status === 'offline' || src.status === 'error')) {
        log(`source back online: ${src.path}`);
        void this.scan(src.id);
      } else if (!ok && src.status === 'idle') {
        log(`source offline: ${src.path}`);
        src.status = 'offline';
        await rt.watcher?.close(); rt.watcher = undefined;
        this.emitSources();
      } else if (ok && src.status === 'idle' && src.kind === 'network' && !rt.watcher) {
        void this.scan(src.id); // polling disabled for this share → periodic incremental re-sync
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // persistence
  // ---------------------------------------------------------------------------------------
  persistIndex(id: string): Promise<void> {
    const src = this.sources.find((s) => s.id === id);
    const rt = this.runtime(id);
    if (!src) return rt.persistChain;
    rt.persistChain = rt.persistChain
      .then(() => writeIndexFile(this.deps.store.paths.indexFile(id), { sourceId: id, root: src.path }, this.deps.library.records(id)))
      .catch((e) => warn('index write failed', e));
    return rt.persistChain;
  }

  // ---------------------------------------------------------------------------------------
  // suggestions
  // ---------------------------------------------------------------------------------------
  async suggestions(): Promise<Array<{ label: string; path: string; kind: SourceKind }>> {
    const out: Array<{ label: string; path: string; kind: SourceKind }> = [];
    const have = new Set(this.sources.map((s) => pathKey(s.path)));
    const seen = new Set<string>();
    const push = async (label: string, path: string | undefined, kind?: SourceKind) => {
      if (!path) return;
      const p = normalizePath(path);
      const k = pathKey(p);
      if (seen.has(k) || have.has(k)) return;
      try { if (!(await fsp.stat(p)).isDirectory()) return; } catch { return; }
      seen.add(k);
      out.push({ label, path: p, kind: kind ?? sourceKindOf(p, this.mapped) });
    };
    const roots: Array<[string, string | undefined]> = [
      ['OneDrive', process.env.OneDrive],
      ['OneDrive', process.env.OneDriveConsumer],
      ['OneDrive', process.env.OneDriveCommercial],
    ];
    try {
      const home = homedir();
      for (const d of await fsp.readdir(home, { withFileTypes: true })) {
        if (d.isDirectory() && /^OneDrive/i.test(d.name)) roots.push([d.name, join(home, d.name)]);
      }
    } catch { /* ignore */ }
    for (const [name, root] of roots) {
      if (!root) continue;
      const base = labelOf(root) || name;
      for (const sub of ['Pictures', 'Bilder', 'Fotos', 'Images']) await push(`${base} – ${sub}`, join(root, sub), 'onedrive');
      await push(base, root, 'onedrive');
    }
    await push('Pictures', this.deps.picturesDir?.(), 'local');
    return out;
  }
}

async function dirReachable(path: string, timeoutMs: number): Promise<boolean> {
  try {
    const st = await Promise.race([
      fsp.stat(path),
      new Promise<never>((_, rej) => { const t = setTimeout(() => rej(new Error('timeout')), timeoutMs); t.unref?.(); }),
    ]);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Drive letters mapped to network shares (Windows: parsed from `net use`). */
export function detectMappedDrives(): Promise<Set<string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Set());
  return new Promise((resolve) => {
    try {
      execFile('net', ['use'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        const set = new Set<string>();
        if (!err) for (const m of String(stdout).matchAll(/\b([A-Z]):\s+(\\\\\S+)/gi)) set.add(m[1].toUpperCase());
        resolve(set);
      });
    } catch {
      resolve(new Set());
    }
  });
}
