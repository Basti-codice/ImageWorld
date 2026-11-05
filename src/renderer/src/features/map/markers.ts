import { Marker, type Map as MlMap } from 'maplibre-gl';
import type { Photo } from '@shared/types';
import { thumbUrl } from '@/lib/media';
import { tn } from '@/i18n';
import type { Cluster } from './cluster';

export type MarkerMode = 'thumb' | 'dot';
export interface PlaybackCtx { cursor: number; windowMs: number }

interface Entry { marker: Marker; root: HTMLDivElement; sig: string; lon: number; lat: number; leaving?: number }

export interface MarkerCallbacks {
  click(c: Cluster): void;
  hover(photoId: string | null): void;
}

const fmtCount = (n: number) => (n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n / 1000)}k`);
const sizeFor = (n: number) => (n < 2 ? 40 : n < 10 ? 48 : n < 100 ? 54 : n < 1000 ? 60 : 68);

/**
 * Pooled DOM markers (thumbnail pins / count bubbles) for the top-N clusters in view. Everything else is drawn by the
 * overflow circle layer of the controller, so the DOM never grows beyond `limit` nodes.
 */
export class MarkerLayer {
  private entries = new Map<string, Entry>();
  private hoverId: string | null = null;
  private current: { repId: string; key: string }[] = [];
  disabled = false;

  constructor(private map: MlMap, private cb: MarkerCallbacks) {}

  get size() { return this.entries.size; }

  update(clusters: Cluster[], photos: Photo[], mode: MarkerMode, playback: PlaybackCtx | null) {
    const want = new Set<string>();
    let z = clusters.length;
    for (const c of clusters) {
      const key = `${mode}:${c.key}`;
      want.add(key);
      const photo = photos[c.rep];
      const single = c.count === 1;
      const fresh = playback ? photos[c.newest].sortTime >= playback.cursor - playback.windowMs : null;
      const sig = `${photo.id}|${c.count}|${fresh}`;
      let e = this.entries.get(key);
      if (e && e.leaving) { clearTimeout(e.leaving); e.leaving = undefined; e.root.classList.remove('is-leaving'); }
      if (!e) {
        const root = document.createElement('div');
        root.className = 'mk-root';
        const marker = new Marker({ element: root, anchor: mode === 'thumb' && single ? 'bottom' : 'center', opacityWhenCovered: '0' }).setLngLat([c.lon, c.lat]).addTo(this.map);
        e = { marker, root, sig: '', lon: c.lon, lat: c.lat };
        this.entries.set(key, e);
      }
      if (e.sig !== sig) { this.paint(e, c, photo, mode, fresh); e.sig = sig; }
      if (e.lon !== c.lon || e.lat !== c.lat) { e.marker.setLngLat([c.lon, c.lat]); e.lon = c.lon; e.lat = c.lat; }
      e.root.style.zIndex = String(fresh ? 2000 + z : z); // smaller clusters on top of bigger ones
      e.root.dataset.hover = this.hoverId === photo.id ? '1' : '';
      z--;
    }
    for (const [key, e] of this.entries) {
      if (want.has(key) || e.leaving) continue;
      e.root.classList.add('is-leaving');
      e.leaving = window.setTimeout(() => { e.marker.remove(); this.entries.delete(key); }, 180);
    }
    this.current = clusters.map((c) => ({ repId: photos[c.rep].id, key: `${mode}:${c.key}` }));
  }

  setHover(id: string | null) {
    this.hoverId = id;
    for (const { repId, key } of this.current) { const e = this.entries.get(key); if (e) e.root.dataset.hover = repId === id ? '1' : ''; }
  }

  setInteractive(on: boolean) { this.disabled = !on; for (const e of this.entries.values()) e.root.style.pointerEvents = on ? '' : 'none'; }

  clear() {
    for (const e of this.entries.values()) { if (e.leaving) clearTimeout(e.leaving); e.marker.remove(); }
    this.entries.clear(); this.current = [];
  }

  private paint(e: Entry, c: Cluster, photo: Photo, mode: MarkerMode, fresh: boolean | null) {
    const root = e.root;
    root.replaceChildren();
    const single = c.count === 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mk mk--${mode} mk--${single ? 'single' : 'cluster'}${fresh === true ? ' mk--fresh' : ''}${fresh === false ? ' mk--old' : ''}`;
    btn.setAttribute('aria-label', tn('map.cluster.aria', c.count));
    root.style.pointerEvents = this.disabled ? 'none' : '';
    if (mode === 'thumb') {
      const s = sizeFor(c.count);
      btn.style.setProperty('--sz', `${s}px`);
      if (!single) { for (let i = 1; i <= 2; i++) { const g = document.createElement('span'); g.className = `mk__ghost mk__ghost--${i}`; btn.appendChild(g); } }
      const frame = document.createElement('span');
      frame.className = 'mk__frame';
      if (photo.color) frame.style.background = photo.color;
      const img = document.createElement('img');
      img.alt = ''; img.draggable = false; img.decoding = 'async'; img.loading = 'eager';
      img.onload = () => img.classList.add('is-in');
      img.src = thumbUrl(photo, 256);
      frame.appendChild(img);
      btn.appendChild(frame);
      if (single) { const tail = document.createElement('span'); tail.className = 'mk__tail'; btn.appendChild(tail); }
      else { const b = document.createElement('span'); b.className = 'mk__badge tabular'; b.textContent = fmtCount(c.count); btn.appendChild(b); }
    } else if (single) {
      btn.style.setProperty('--sz', '14px');
    } else {
      const s = c.count < 10 ? 26 : c.count < 100 ? 32 : c.count < 1000 ? 40 : 48;
      btn.style.setProperty('--sz', `${s}px`);
      const b = document.createElement('span'); b.className = 'mk__count tabular'; b.textContent = fmtCount(c.count); btn.appendChild(b);
    }
    let dx = 0, dy = 0;
    btn.addEventListener('pointerdown', (ev) => { dx = ev.clientX; dy = ev.clientY; });
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); if (Math.hypot(ev.clientX - dx, ev.clientY - dy) < 5 || ev.detail === 0) this.cb.click(c); });
    btn.addEventListener('dblclick', (ev) => ev.stopPropagation());
    if (single) {
      btn.addEventListener('pointerenter', () => this.cb.hover(photo.id));
      btn.addEventListener('pointerleave', () => this.cb.hover(null));
    }
    root.appendChild(btn);
  }
}
