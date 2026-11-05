// In-memory photo library: single source of truth for Photo objects (user state merged in), batched diff events.
import { basename } from 'node:path';
import type { LibraryDiff, Photo, PhotoPatch, Place } from '@shared/types';
import type { ParsedMeta } from './metadata';
import type { IndexRecord, Store, UserState } from './store';
import { toRecord } from './store';
import { extOf, mediaKindOfExt, photoIdOf } from './util';

interface BaseGeo { lat: number | null; lon: number | null; alt?: number | null; place?: Place }

export interface FileStat { path: string; size: number; mtime: number }

type Listener = (diff: LibraryDiff) => void;
const MAX_CHUNK = 3000;

export class Library {
  private readonly photos = new Map<string, Photo>();
  private readonly bySource = new Map<string, Set<string>>();
  /** exif coordinates of photos that currently carry a manual location override */
  private readonly baseGeo = new Map<string, BaseGeo>();
  private readonly cloud = new Set<string>();
  private readonly failedMeta = new Set<string>();

  private pAdded = new Map<string, Photo>();
  private pUpdated = new Map<string, Photo>();
  private pLazy = new Map<string, Photo>();
  private pRemoved = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private lastLazyFlush = 0;
  private listeners = new Set<Listener>();

  constructor(private readonly store: Store, private readonly reverse: (lat: number, lon: number) => Promise<Place | undefined>, private readonly batchMs = 250) {}

  // ---- reads
  get size() { return this.photos.size; }
  get(id: string): Photo | undefined { return this.photos.get(id); }
  getAll(): Photo[] { return Array.from(this.photos.values()); }
  isCloudOnly(id: string) { return this.cloud.has(id); }
  idsOfSource(sourceId: string): Set<string> { return this.bySource.get(sourceId) ?? new Set(); }
  countOfSource(sourceId: string): number { return this.bySource.get(sourceId)?.size ?? 0; }
  forEachOfSource(sourceId: string, fn: (p: Photo) => void) {
    for (const id of this.bySource.get(sourceId) ?? []) { const p = this.photos.get(id); if (p) fn(p); }
  }

  onDiff(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- construction
  /** @returns true when a manual location override was applied */
  private applyUserState(p: Photo, us: UserState | undefined): boolean {
    p.favorite = !!us?.favorite;
    p.rating = clampRating(us?.rating ?? 0);
    p.tags = us?.tags ? [...us.tags] : [];
    this.baseGeo.delete(p.id);
    if (us?.location) {
      this.baseGeo.set(p.id, { lat: p.lat, lon: p.lon, alt: p.alt, place: p.place });
      p.lat = us.location.lat;
      p.lon = us.location.lon;
      p.alt = null;
      p.geoSource = 'manual';
      delete p.place; // resolved asynchronously by resolveManualPlace() once the photo is stored
      return true;
    }
    return false;
  }

  private async resolveManualPlace(id: string) {
    const p = this.photos.get(id);
    if (!p || p.geoSource !== 'manual' || p.lat == null || p.lon == null) return;
    const { lat, lon } = p;
    const place = await this.reverse(lat, lon).catch(() => undefined);
    const cur = this.photos.get(id);
    if (!cur || cur.geoSource !== 'manual' || cur.lat !== lat || cur.lon !== lon) return;
    if (JSON.stringify(cur.place) === JSON.stringify(place)) return;
    cur.place = place;
    this.queueUpdated(cur);
  }

  /** Builds a Photo from stat + parsed metadata and stores it (adds or replaces). */
  ingest(sourceId: string, file: FileStat, meta: ParsedMeta | null, place: Place | undefined, flags?: { cloud?: boolean; failed?: boolean }): Photo {
    const id = photoIdOf(file.path);
    const ext = extOf(file.path);
    const kind = mediaKindOfExt(ext) ?? 'photo';
    const prev = this.photos.get(id);
    const p: Photo = {
      id, path: file.path, sourceId, name: basename(file.path), kind, ext, size: file.size, mtime: file.mtime,
      takenAt: meta?.takenAt ?? null,
      sortTime: meta?.takenAt ?? file.mtime,
      width: meta?.width ?? 0, height: meta?.height ?? 0,
      lat: meta?.lat ?? null, lon: meta?.lon ?? null,
      geoSource: meta?.lat != null ? 'exif' : null,
      favorite: false, rating: 0, tags: [],
    };
    if (meta?.duration != null) p.duration = meta.duration;
    if (meta?.alt != null) p.alt = meta.alt;
    if (place && meta?.lat != null) p.place = place;
    if (meta?.camera) p.camera = meta.camera;
    if (meta?.lens) p.lens = meta.lens;
    if (meta?.iso != null) p.iso = meta.iso;
    if (meta?.aperture != null) p.aperture = meta.aperture;
    if (meta?.shutter) p.shutter = meta.shutter;
    if (meta?.focalLength != null) p.focalLength = meta.focalLength;
    const manual = this.applyUserState(p, this.store.userstate.value[id]);
    this.cloud.delete(id);
    this.failedMeta.delete(id);
    if (flags?.cloud) this.cloud.add(id);
    if (flags?.failed) this.failedMeta.add(id);
    this.put(p, !!prev);
    if (manual) void this.resolveManualPlace(id);
    return p;
  }

  /** Loads persisted records (startup) without emitting a diff – the renderer pulls with getAll(). */
  loadRecords(sourceId: string, records: IndexRecord[]) {
    for (const r of records) {
      const id = photoIdOf(r.p);
      const ext = extOf(r.p);
      const kind = mediaKindOfExt(ext);
      if (!kind) continue;
      const p: Photo = {
        id, path: r.p, sourceId, name: basename(r.p), kind, ext, size: r.s, mtime: r.m,
        takenAt: r.t ?? null, sortTime: r.t ?? r.m, width: r.w, height: r.h,
        lat: r.la ?? null, lon: r.lo ?? null, geoSource: r.la != null ? 'exif' : null,
        favorite: false, rating: 0, tags: [],
      };
      if (r.d != null) p.duration = r.d;
      if (r.al != null) p.alt = r.al;
      if (r.pl) p.place = r.pl;
      if (r.ca) p.camera = r.ca;
      if (r.le) p.lens = r.le;
      if (r.iso != null) p.iso = r.iso;
      if (r.ap != null) p.aperture = r.ap;
      if (r.sh) p.shutter = r.sh;
      if (r.fl != null) p.focalLength = r.fl;
      if (r.co) p.color = r.co;
      const manual = this.applyUserState(p, this.store.userstate.value[id]);
      if (r.c) this.cloud.add(id);
      if (r.x) this.failedMeta.add(id);
      this.photos.set(id, p);
      let set = this.bySource.get(sourceId);
      if (!set) this.bySource.set(sourceId, (set = new Set()));
      set.add(id);
      if (manual) void this.resolveManualPlace(id);
    }
  }

  private put(p: Photo, existed: boolean) {
    this.photos.set(p.id, p);
    let set = this.bySource.get(p.sourceId);
    if (!set) this.bySource.set(p.sourceId, (set = new Set()));
    set.add(p.id);
    this.pLazy.delete(p.id);
    if (this.pRemoved.has(p.id)) {
      this.pRemoved.delete(p.id);
      this.pUpdated.set(p.id, p);
    } else if (existed && !this.pAdded.has(p.id)) this.pUpdated.set(p.id, p);
    else this.pAdded.set(p.id, p);
    this.schedule();
  }

  remove(ids: Iterable<string>) {
    for (const id of ids) {
      const p = this.photos.get(id);
      if (!p) continue;
      this.photos.delete(id);
      this.bySource.get(p.sourceId)?.delete(id);
      this.baseGeo.delete(id);
      this.cloud.delete(id);
      this.failedMeta.delete(id);
      this.pLazy.delete(id);
      this.pUpdated.delete(id);
      if (this.pAdded.delete(id)) continue; // never reached the renderer
      this.pRemoved.add(id);
    }
    this.schedule();
  }

  removeSource(sourceId: string) {
    this.remove(Array.from(this.bySource.get(sourceId) ?? []));
    this.bySource.delete(sourceId);
  }

  /** Persisted representation of one source. */
  *records(sourceId: string): Generator<IndexRecord> {
    for (const id of this.bySource.get(sourceId) ?? []) {
      const p = this.photos.get(id);
      if (!p) continue;
      yield toRecord(p, this.baseGeo.get(id), { cloud: this.cloud.has(id), failed: this.failedMeta.has(id) });
    }
  }

  // ---- thumbnails: average colour arrives later
  setColor(id: string, color: string) {
    const p = this.photos.get(id);
    if (!p || p.color === color) return;
    p.color = color;
    if (this.pAdded.has(id) || this.pUpdated.has(id)) return; // will be sent anyway (object is shared)
    this.pLazy.set(id, p);
    this.schedule();
  }

  // ---- user state
  update(ids: string[], patch: PhotoPatch) {
    const us = this.store.userstate.value;
    const changed: Photo[] = [];
    for (const id of ids) {
      const p = this.photos.get(id);
      if (!p) continue;
      const cur: UserState = { ...(us[id] ?? {}) };
      if (patch.favorite !== undefined) { p.favorite = !!patch.favorite; if (p.favorite) cur.favorite = true; else delete cur.favorite; }
      if (patch.rating !== undefined) { p.rating = clampRating(patch.rating); if (p.rating > 0) cur.rating = p.rating; else delete cur.rating; }
      if (patch.tags !== undefined) {
        const tags = Array.from(new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean)));
        p.tags = tags;
        if (tags.length) cur.tags = tags; else delete cur.tags;
      }
      if (patch.location !== undefined) {
        if (patch.location && isFinite(patch.location.lat) && isFinite(patch.location.lon)) {
          if (!this.baseGeo.has(id)) this.baseGeo.set(id, { lat: p.lat, lon: p.lon, alt: p.alt, place: p.place });
          p.lat = patch.location.lat; p.lon = patch.location.lon; p.alt = null; p.geoSource = 'manual';
          cur.location = { lat: patch.location.lat, lon: patch.location.lon };
          void this.resolveManualPlace(id);
        } else {
          const base = this.baseGeo.get(id);
          if (base) {
            p.lat = base.lat; p.lon = base.lon; p.alt = base.alt ?? null; p.place = base.place;
            p.geoSource = base.lat != null ? 'exif' : null;
            if (base.alt == null) delete p.alt;
            if (!base.place) delete p.place;
            this.baseGeo.delete(id);
          }
          delete cur.location;
        }
      }
      if (Object.keys(cur).length) us[id] = cur; else delete us[id];
      changed.push(p);
    }
    if (changed.length) {
      this.store.userstate.touch();
      for (const p of changed) { this.pLazy.delete(p.id); if (!this.pAdded.has(p.id)) this.pUpdated.set(p.id, p); }
      this.schedule();
    }
  }

  private queueUpdated(p: Photo) {
    this.pLazy.delete(p.id);
    if (!this.pAdded.has(p.id)) this.pUpdated.set(p.id, p);
    this.schedule();
  }

  // ---- diff batching
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, this.batchMs);
    this.timer.unref?.();
  }

  /** Emits pending changes. Colour-only updates are throttled to once every 2 s unless `force`. */
  flush(force = true) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const now = Date.now();
    const includeLazy = force || now - this.lastLazyFlush >= 2000;
    if (includeLazy) this.lastLazyFlush = now;
    const added = Array.from(this.pAdded.values());
    const updated = Array.from(this.pUpdated.values());
    if (includeLazy) for (const p of this.pLazy.values()) updated.push(p);
    const removedIds = Array.from(this.pRemoved);
    this.pAdded = new Map(); this.pUpdated = new Map(); this.pRemoved = new Set();
    if (includeLazy) this.pLazy = new Map();
    else if (this.pLazy.size) this.schedule();
    if (!added.length && !updated.length && !removedIds.length) return;
    const emit = (d: LibraryDiff) => { for (const l of this.listeners) { try { l(d); } catch { /* listener errors must not break indexing */ } } };
    // keep IPC messages reasonably sized
    const n = Math.max(Math.ceil(added.length / MAX_CHUNK), Math.ceil(updated.length / MAX_CHUNK), Math.ceil(removedIds.length / (MAX_CHUNK * 3)), 1);
    for (let i = 0; i < n; i++) {
      emit({
        added: added.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
        updated: updated.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
        removedIds: removedIds.slice(i * MAX_CHUNK * 3, (i + 1) * MAX_CHUNK * 3),
      });
    }
  }
}

function clampRating(n: number): number {
  const r = Math.round(Number(n));
  return Number.isFinite(r) ? Math.max(0, Math.min(5, r)) : 0;
}
