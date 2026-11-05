// Main-thread facade for the offline geocoder. Runs the heavy index in a worker_thread when a worker file is
// provided (production); otherwise (tests / worker failure) builds the index in-process.
import { Worker } from 'node:worker_threads';
import type { GeocodeResult, Place } from '@shared/types';
import { getPlaceIndex } from './places';
import { warn } from './util';

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void }

export class PlaceService {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, Place | null>();
  private queue: Array<{ key: string; lat: number; lon: number; waiters: Array<(p: Place | undefined) => void> }> = [];
  private flushing = false;

  constructor(private readonly workerFile?: string) {}

  private ensureWorker(): Worker | null {
    if (this.broken || !this.workerFile) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(this.workerFile);
      w.on('message', (m: { id: number; result?: unknown; error?: string }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
      });
      const fail = (e: unknown) => {
        warn('places worker failed, falling back to in-process index', e);
        this.broken = true;
        this.worker = null;
        for (const p of this.pending.values()) p.reject(new Error('places worker stopped'));
        this.pending.clear();
      };
      w.on('error', fail);
      w.on('exit', (code) => { if (this.worker === w) fail(`exit ${code}`); });
      w.unref();
      this.worker = w;
      return w;
    } catch (e) {
      warn('cannot start places worker', e);
      this.broken = true;
      return null;
    }
  }

  private async call<T>(msg: Record<string, unknown>, local: () => Promise<T>): Promise<T> {
    const w = this.ensureWorker();
    if (w) {
      try {
        return await new Promise<T>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, reject });
          w.postMessage({ id, ...msg });
        });
      } catch (e) {
        if (!this.broken) throw e;
      }
    }
    return local();
  }

  /** start building the index in the background */
  warm(): void {
    void this.call({ type: 'warm' }, async () => (await getPlaceIndex()).size).catch(() => undefined);
  }

  /** Reverse-geocodes one coordinate; coalesces calls from the same tick into a single worker message. */
  reverse(lat: number, lon: number): Promise<Place | undefined> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit ?? undefined);
    return new Promise((resolve) => {
      const existing = this.queue.find((q) => q.key === key);
      if (existing) existing.waiters.push(resolve);
      else this.queue.push({ key, lat, lon, waiters: [resolve] });
      if (!this.flushing) {
        this.flushing = true;
        setTimeout(() => void this.flush(), 4);
      }
    });
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0, 400);
    this.flushing = this.queue.length > 0;
    if (this.flushing) setTimeout(() => void this.flush(), 0);
    if (!batch.length) return;
    const points = batch.map((b) => [b.lat, b.lon] as [number, number]);
    let results: Array<Place | undefined> = [];
    try {
      results = await this.call({ type: 'reverse', points }, async () => (await getPlaceIndex()).reverseMany(points));
    } catch (e) {
      warn('reverse geocode failed', e);
    }
    batch.forEach((b, i) => {
      const r = results[i];
      if (this.cache.size > 20000) this.cache.clear();
      this.cache.set(b.key, r ?? null);
      for (const w of b.waiters) w(r);
    });
  }

  search(query: string, lang: string, limit = 8): Promise<GeocodeResult[]> {
    return this.call({ type: 'search', query, lang, limit }, async () => (await getPlaceIndex()).search(query, lang, limit));
  }

  async shutdown(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.broken = true;
    await w?.terminate().catch(() => undefined);
  }
}
