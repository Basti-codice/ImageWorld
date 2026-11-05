// chokidar watcher per source → debounced batches of changes.
import { relative } from 'node:path';
import type { Source } from '@shared/types';
import type { FileChanges } from './scanner';
import { ignoredDirName, ignoredFileName } from './scanner';
import { isMediaFile, warn } from './util';

export interface SourceWatcher { close(): Promise<void> }

export async function startWatcher(source: Source, onBatch: (c: FileChanges) => void, opts: { debounceMs?: number; usePolling?: boolean } = {}): Promise<SourceWatcher> {
  const chokidar = await import('chokidar');
  const root = source.path;
  const usePolling = opts.usePolling ?? source.kind === 'network';
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    ignorePermissionErrors: true,
    usePolling,
    interval: 5000,
    binaryInterval: 15000,
    atomic: 500,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 },
    ignored: (path: string, stats?: { isFile(): boolean; isDirectory(): boolean }) => {
      const rel = relative(root, path);
      if (!rel) return false;
      const parts = rel.split(/[\\/]/);
      const last = parts[parts.length - 1];
      for (let i = 0; i < parts.length - 1; i++) if (ignoredDirName(parts[i])) return true;
      if (stats?.isFile()) return !isMediaFile(path) || ignoredFileName(last);
      if (stats?.isDirectory()) return ignoredDirName(last);
      // stats unknown yet: files with a known non-media extension are ignored, everything else is checked later
      return ignoredFileName(last);
    },
  });

  let changes: FileChanges = { upserts: new Set(), removes: new Set(), removeDirs: new Set() };
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    const c = changes;
    changes = { upserts: new Set(), removes: new Set(), removeDirs: new Set() };
    if (c.upserts.size || c.removes.size || c.removeDirs.size) onBatch(c);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, opts.debounceMs ?? 1500);
  };
  watcher.on('add', (p: string) => { if (isMediaFile(p)) { changes.removes.delete(p); changes.upserts.add(p); schedule(); } });
  watcher.on('change', (p: string) => { if (isMediaFile(p)) { changes.upserts.add(p); schedule(); } });
  watcher.on('unlink', (p: string) => { if (isMediaFile(p)) { changes.upserts.delete(p); changes.removes.add(p); schedule(); } });
  watcher.on('unlinkDir', (p: string) => { changes.removeDirs.add(p); schedule(); });
  watcher.on('error', (e: unknown) => warn('watcher error', root, (e as Error)?.message ?? e));

  return {
    async close() {
      if (timer) { clearTimeout(timer); timer = null; }
      await watcher.close().catch(() => undefined);
    },
  };
}
