// Test harness: a complete (electron-free) backend wired like in src/main/index.ts.
import { rmSync } from 'node:fs';
import type { LibraryDiff, ScanProgress, Source } from '@shared/types';
import { CloudChecker } from '../../src/main/cloud';
import { Library } from '../../src/main/library';
import { PlaceService } from '../../src/main/place-service';
import { SourceManager, type SourceManagerDeps } from '../../src/main/sources';
import { Paths, Store } from '../../src/main/store';
import { tempDir } from './fixtures';

export interface TestEnv {
  userData: string;
  paths: Paths;
  store: Store;
  library: Library;
  places: PlaceService;
  mgr: SourceManager;
  diffs: LibraryDiff[];
  progress: ScanProgress[];
  sourceEvents: Source[][];
  close: () => Promise<void>;
}

export function makeEnv(opts: { userData?: string; mgr?: Partial<SourceManagerDeps>; batchMs?: number } = {}): TestEnv {
  const userData = opts.userData ?? tempDir('iw-userdata-');
  const paths = new Paths(userData);
  const store = new Store(paths);
  store.load();
  const places = new PlaceService();
  const library = new Library(store, (la, lo) => places.reverse(la, lo), opts.batchMs ?? 250);
  const diffs: LibraryDiff[] = [];
  const progress: ScanProgress[] = [];
  const sourceEvents: Source[][] = [];
  library.onDiff((d) => diffs.push(d));
  const mgr = new SourceManager({
    store, library, places, cloud: new CloudChecker(),
    settings: () => store.settings.value,
    onSourcesChanged: (l) => sourceEvents.push(l),
    onProgress: (p) => progress.push(p),
    watch: false,
    probeIntervalMs: 200,
    ...opts.mgr,
  });
  return {
    userData, paths, store, library, places, mgr, diffs, progress, sourceEvents,
    close: async () => {
      await mgr.shutdown();
      await store.flushAll();
      await places.shutdown();
      if (!opts.userData) rmSync(userData, { recursive: true, force: true });
    },
  };
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 20_000, stepMs = 50): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export const idle = (env: TestEnv, id: string) => () => {
  const s = env.mgr.list().find((x) => x.id === id);
  return !!s && s.status === 'idle' && s.lastScan !== null;
};
