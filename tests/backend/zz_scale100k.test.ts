import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import type { ParsedMeta } from '../../src/main/metadata';
import { makeEnv, idle, waitFor } from './env';
import { tempDir } from './fixtures';

it('100k', async () => {
  const work = tempDir('iw-100k-');
  try {
    const N = 120_000;
    for (let d = 0; d < 200; d++) {
      const sub = join(work, `d${d}`); mkdirSync(sub);
      for (let i = 0; i < N / 200; i++) writeFileSync(join(sub, `IMG_${d}_${i}.jpg`), '');
    }
    const readMeta = async (_f: string, _e: string, _k: 'photo' | 'video', mtime: number): Promise<ParsedMeta> => ({
      takenAt: mtime, width: 4000, height: 3000, lat: -60 + Math.random() * 120, lon: -170 + Math.random() * 340, alt: null, camera: 'Test Cam', lens: 'Lens 24-70', iso: 100, aperture: 2.8, shutter: '1/250', focalLength: 35,
    });
    const env = makeEnv({ mgr: { readMeta } });
    await env.mgr.init();
    let maxStall = 0; let last = Date.now();
    const timer = setInterval(() => { const n = Date.now(); maxStall = Math.max(maxStall, n - last - 20); last = n; }, 20);
    const t0 = Date.now();
    const src = await env.mgr.add(work);
    await waitFor(idle(env, src.id), 600_000, 200);
    clearInterval(timer);
    const mem = process.memoryUsage();
    console.log(`100k: ${env.library.size} in ${Date.now() - t0} ms, stall ${maxStall} ms, rss ${Math.round(mem.rss / 1e6)} MB heap ${Math.round(mem.heapUsed / 1e6)} MB, index file ${Math.round(statSync(env.paths.indexFile(src.id)).size / 1e6)} MB`);
    expect(env.library.size).toBe(N);
    const t1 = Date.now();
    const all = env.library.getAll();
    const json = JSON.stringify(all).length;
    console.log(`getAll+stringify: ${Date.now() - t1} ms, ${Math.round(json / 1e6)} MB json`);
    await env.close();
    // reload
    const e2 = makeEnv({ userData: env.userData });
    const t2 = Date.now();
    await e2.mgr.init();
    console.log(`reload cached index: ${Date.now() - t2} ms, ${e2.library.size} photos`);
    const t3 = Date.now();
    await e2.mgr.start();
    await waitFor(idle(e2, src.id), 600_000, 200);
    console.log(`incremental rescan: ${Date.now() - t3} ms`);
    await e2.close();
    rmSync(env.userData, { recursive: true, force: true });
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 900_000);
