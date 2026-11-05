// Discovery + incremental indexing of one source folder. Files are indexed in place and never modified.
import { promises as fsp, type Dirent } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Photo, ScanProgress, Settings, Source } from '@shared/types';
import type { CloudChecker } from './cloud';
import type { Library, FileStat } from './library';
import { parseTags, readMetadata, type ParsedMeta } from './metadata';
import type { PlaceService } from './place-service';
import type { ThumbService } from './thumbs';
import { SHARP_EXT, extOf, isInside, isMediaFile, mapLimit, mediaKindOfExt, photoIdOf, warn } from './util';

export interface ScanDeps {
  library: Library;
  places: PlaceService;
  settings: () => Settings;
  cloud: CloudChecker;
  thumbs?: ThumbService;
  progress: (p: ScanProgress) => void;
  /** request a (debounced) index persist */
  persist: (sourceId: string) => void;
  /** injectable for tests */
  readMeta?: (file: string, ext: string, kind: 'photo' | 'video', mtime: number) => Promise<ParsedMeta>;
  readConcurrency?: number;
}

export interface ScanSummary { found: number; added: number; updated: number; removed: number }

const IGNORED_DIRS = /^(\..*|\$recycle\.bin|system volume information|@eadir|#recycle|thumbs?|\.thumbnails)$/i;
const IGNORED_FILES = /^(\._.*|~\$.*|.*\.(tmp|part|crdownload|partial))$/i;

export const ignoredDirName = (n: string) => IGNORED_DIRS.test(n);
export const ignoredFileName = (n: string) => IGNORED_FILES.test(n);

export class ScanAborted extends Error {
  constructor() { super('scan aborted'); this.name = 'ScanAborted'; }
}

/** Recursively lists media files. Throws if the root itself cannot be read; unreadable subfolders go to `failedDirs`. */
export async function discover(root: string, signal: AbortSignal, onCount: (n: number) => void, failedDirs: string[]): Promise<FileStat[]> {
  const out: FileStat[] = [];
  const stack = [root];
  while (stack.length) {
    if (signal.aborted) throw new ScanAborted();
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (dir === root) throw e;
      failedDirs.push(dir);
      continue;
    }
    const files: string[] = [];
    for (const d of entries) {
      if (d.isDirectory()) {
        if (!ignoredDirName(d.name)) stack.push(join(dir, d.name));
      } else if ((d.isFile() || d.isSymbolicLink()) && isMediaFile(d.name) && !ignoredFileName(d.name)) {
        files.push(join(dir, d.name));
      }
    }
    for (let i = 0; i < files.length; i += 48) {
      await Promise.all(files.slice(i, i + 48).map(async (f) => {
        try {
          const st = await fsp.stat(f);
          if (st.isFile()) out.push({ path: f, size: st.size, mtime: Math.floor(st.mtimeMs) });
        } catch { /* vanished or unreadable */ }
      }));
    }
    onCount(out.length);
  }
  return out;
}

function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  return (...a: A) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
  };
}

/** Reads metadata for one file and stores the resulting Photo in the library. */
export async function ingestFile(deps: ScanDeps, sourceId: string, f: FileStat, cloudOnly = false): Promise<Photo> {
  const ext = extOf(f.path);
  const kind = mediaKindOfExt(ext) ?? 'photo';
  const name = f.path.slice(Math.max(f.path.lastIndexOf('/'), f.path.lastIndexOf('\\')) + 1);
  if (cloudOnly) {
    return deps.library.ingest(sourceId, f, parseTags({}, { ext, kind, name, mtime: f.mtime }), undefined, { cloud: true });
  }
  let meta: ParsedMeta;
  let failed = false;
  try {
    meta = await (deps.readMeta ?? readMetadata)(f.path, ext, kind, f.mtime);
  } catch (e) {
    failed = true;
    if (process.env.IMAGEWORLD_DEBUG === '1') warn('metadata failed', f.path, (e as Error).message);
    meta = parseTags({}, { ext, kind, name, mtime: f.mtime });
  }
  if ((!meta.width || !meta.height) && SHARP_EXT.has(ext)) {
    try {
      const m = await sharp(f.path, { failOn: 'none' }).metadata();
      const swap = (m.orientation ?? 1) >= 5;
      meta.width = (swap ? m.height : m.width) ?? 0;
      meta.height = (swap ? m.width : m.height) ?? 0;
    } catch { /* leave 0x0 */ }
  }
  const place = meta.lat != null && meta.lon != null ? await deps.places.reverse(meta.lat, meta.lon) : undefined;
  return deps.library.ingest(sourceId, f, meta, place, { failed });
}

export async function scanSource(deps: ScanDeps, source: Source, signal: AbortSignal): Promise<ScanSummary> {
  const { library } = deps;
  const sourceId = source.id;
  const emit = throttle((p: ScanProgress) => deps.progress(p), 150);

  // ---- 1. discovery
  const failedDirs: string[] = [];
  deps.progress({ sourceId, phase: 'discovering', done: 0, total: 0 });
  const found = await discover(source.path, signal, (n) => emit({ sourceId, phase: 'discovering', done: n, total: n }), failedDirs);
  if (signal.aborted) throw new ScanAborted();

  // ---- 2. diff against cache
  const seen = new Set<string>();
  const toRead: FileStat[] = [];
  let updated = 0;
  const skipCloud = deps.settings().skipCloudOnlyFiles && source.kind === 'onedrive';
  let offline: Set<string> | null = null;
  let offlineLoaded = false;
  const needsCloudCheck: FileStat[] = [];
  for (const f of found) {
    const id = photoIdOf(f.path);
    const existing = library.get(id);
    if (existing && existing.sourceId !== sourceId) continue; // owned by another source
    seen.add(id);
    const cloudFlagged = library.isCloudOnly(id);
    if (!existing) { toRead.push(f); continue; }
    if (existing.size !== f.size || existing.mtime !== f.mtime) { updated++; toRead.push(f); continue; }
    if (cloudFlagged) needsCloudCheck.push(f);
  }
  // placeholders that were skipped earlier: read them once they are available locally (or the user allowed downloads)
  if (needsCloudCheck.length) {
    if (skipCloud) { offline = await deps.cloud.offlineFiles(source.path); offlineLoaded = true; }
    for (const f of needsCloudCheck) {
      if (!skipCloud || !offline || !offline.has(f.path.toLowerCase())) toRead.push(f);
    }
  }

  let removed = 0;
  {
    const gone: string[] = [];
    for (const id of library.idsOfSource(sourceId)) {
      if (seen.has(id)) continue;
      const p = library.get(id);
      if (p && failedDirs.some((d) => isInside(d, p.path))) continue; // folder temporarily unreadable → keep cached entries
      gone.push(id);
    }
    removed = gone.length;
    library.remove(gone);
  }

  // ---- 3. reading
  const added = toRead.filter((f) => !library.get(photoIdOf(f.path))).length;
  if (toRead.length && skipCloud && !offlineLoaded) offline = await deps.cloud.offlineFiles(source.path);
  const total = toRead.length;
  let done = 0;
  const fresh: string[] = [];
  deps.progress({ sourceId, phase: 'reading', done: 0, total });
  let lastPersist = Date.now();
  await mapLimit(toRead, deps.readConcurrency ?? 6, async (f) => {
    const cloudOnly = skipCloud && !!offline && offline.has(f.path.toLowerCase());
    try {
      const p = await ingestFile(deps, sourceId, f, cloudOnly);
      if (!cloudOnly) fresh.push(p.id);
    } catch (e) {
      warn('index failed', f.path, e);
    }
    done++;
    emit({ sourceId, phase: 'reading', done, total, currentFile: f.path });
    if (Date.now() - lastPersist > 20_000) { lastPersist = Date.now(); deps.persist(sourceId); }
  }, signal);
  if (signal.aborted) { deps.persist(sourceId); throw new ScanAborted(); }
  deps.progress({ sourceId, phase: 'reading', done: total, total });
  library.flush(false);

  // ---- 4. thumbnails (background, low priority): new files + anything that still lacks an average colour
  if (deps.thumbs) {
    const ids = new Set<string>(fresh);
    library.forEachOfSource(sourceId, (p) => { if (!p.color && !library.isCloudOnly(p.id)) ids.add(p.id); });
    deps.thumbs.prefetch(sourceId, Array.from(ids));
  }
  return { found: found.length, added, updated, removed };
}

export interface FileChanges { upserts: Set<string>; removes: Set<string>; removeDirs: Set<string> }

/** Applies a debounced batch of watcher events. */
export async function applyFileChanges(deps: ScanDeps, source: Source, ch: FileChanges): Promise<void> {
  const { library } = deps;
  for (const dir of ch.removeDirs) {
    const gone: string[] = [];
    library.forEachOfSource(source.id, (p) => { if (isInside(dir, p.path)) gone.push(p.id); });
    library.remove(gone);
  }
  for (const f of ch.removes) library.remove([photoIdOf(f)]);
  const fresh: string[] = [];
  const skipCloud = deps.settings().skipCloudOnlyFiles && source.kind === 'onedrive';
  await mapLimit(ch.upserts, deps.readConcurrency ?? 4, async (path) => {
    if (!isMediaFile(path)) return;
    let st;
    try { st = await fsp.stat(path); } catch { library.remove([photoIdOf(path)]); return; }
    if (!st.isFile()) return;
    const f: FileStat = { path, size: st.size, mtime: Math.floor(st.mtimeMs) };
    const existing = library.get(photoIdOf(path));
    if (existing && existing.sourceId !== source.id) return;
    if (existing && existing.size === f.size && existing.mtime === f.mtime && !library.isCloudOnly(existing.id)) return;
    const cloudOnly = skipCloud && (await deps.cloud.isOffline(path));
    const p = await ingestFile(deps, source.id, f, cloudOnly);
    if (!cloudOnly) fresh.push(p.id);
  });
  if (deps.thumbs && fresh.length) deps.thumbs.prefetch(source.id, fresh);
  deps.persist(source.id);
}
