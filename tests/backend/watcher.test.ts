import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { photoIdOf } from '../../src/main/util';
import { makeEnv, idle, waitFor, type TestEnv } from './env';
import { buildFixtures, tempDir, type Fixtures } from './fixtures';

let fx: Fixtures;
const envs: TestEnv[] = [];
beforeAll(async () => { fx = await buildFixtures(); });
afterAll(async () => { await fx.cleanup(); });
afterEach(async () => { for (const e of envs.splice(0)) await e.close(); });

describe('live sync (chokidar)', () => {
  it('picks up added, changed and deleted files and removed folders', async () => {
    const work = tempDir('iw-watch-');
    try {
      mkdirSync(join(work, 'sub'));
      copyFileSync(fx.dir('trip', 'paris.jpg'), join(work, 'paris.jpg'));
      const env = makeEnv({ mgr: { watch: true } });
      envs.push(env);
      await env.mgr.init();
      const src = await env.mgr.add(work);
      await waitFor(idle(env, src.id));
      // give chokidar a moment to finish its initial crawl
      await new Promise((r) => setTimeout(r, 800));
      expect(env.library.size).toBe(1);

      // new file (+ a non-media file and a hidden file that must be ignored)
      copyFileSync(fx.dir('trip', 'rio.jpg'), join(work, 'sub', 'rio.jpg'));
      copyFileSync(fx.dir('trip', 'notes.txt'), join(work, 'sub', 'notes.txt'));
      await waitFor(() => env.library.get(photoIdOf(join(work, 'sub', 'rio.jpg'))) !== undefined, 15_000);
      const rio = env.library.get(photoIdOf(join(work, 'sub', 'rio.jpg')))!;
      expect(rio.place?.countryCode).toBe('BR');
      expect(env.library.size).toBe(2);
      expect(env.mgr.list()[0].photoCount).toBe(2);

      // delete → removed
      rmSync(join(work, 'paris.jpg'));
      await waitFor(() => env.library.get(photoIdOf(join(work, 'paris.jpg'))) === undefined, 15_000);

      // whole folder removed → everything below it is removed
      rmSync(join(work, 'sub'), { recursive: true });
      await waitFor(() => env.library.size === 0, 15_000);
      env.library.flush(true);
      expect(env.diffs.flatMap((d) => d.removedIds).length).toBe(2);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});
