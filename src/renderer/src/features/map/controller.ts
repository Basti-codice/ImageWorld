import { AttributionControl, Map as MlMap, type GeoJSONSource, type LayerSpecification, type LngLatBoundsLike, type PaddingOptions } from 'maplibre-gl';
import type { AreaSelection, MapStyleId, Photo, Polygon } from '@shared/types';
import { getMapStyle, LABEL_LAYER_ID, effectiveMapStyle } from './basemap';
import { PhotoIndex, angularDistance, clusterize, type Cluster } from './cluster';
import { MarkerLayer, type MarkerMode } from './markers';
import { DrawTool, type DrawToolId } from './draw';
import { makeRoute, routeUntil, type LL, type Route } from './route';
import { cssVar, prefersReducedMotion } from './theme';

export interface Viewport {
  bounds: [number, number, number, number];
  zoom: number;
  bearing: number;
  /** the photo array handed to setPhotos */
  photos: Photo[];
  /** indices into `photos` of photos inside the viewport, newest first */
  inView: number[];
}

export interface ControllerHooks {
  openViewer(ids: string[], index: number): void;
  hover(id: string | null): void;
  viewport(v: Viewport): void;
  mapClick(lat: number, lon: number): void;
  toolChange(t: DrawToolId | null): void;
  drawn(poly: Polygon): void;
}

export interface PlaybackState { cursor: number | null; route: boolean; follow: boolean; speed: number }

// camera survives view switches within a session
let lastCam: { center: [number, number]; zoom: number; bearing: number } | null = null;
let introPlayed = false;

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as never[] };
const PAD: PaddingOptions = { top: 76, bottom: 168, left: 80, right: 84 };

function hexA(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

function throttle(fn: () => void, ms: number) {
  let last = 0, timer = 0;
  return {
    call() {
      const now = performance.now();
      if (now - last >= ms) { last = now; fn(); return; }
      if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); fn(); }, ms - (now - last));
    },
    now() { if (timer) { clearTimeout(timer); timer = 0; } last = performance.now(); fn(); },
    cancel() { if (timer) clearTimeout(timer); timer = 0; },
  };
}

const polyFeature = (poly: Polygon) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[...poly, poly[0]]] } });

export class MapController {
  readonly map: MlMap;
  private ix = new PhotoIndex([]);
  private photos: Photo[] = [];
  private markers: MarkerLayer;
  private draw: DrawTool | null = null;
  private ready = false;
  private destroyed = false;
  private fitted = !!lastCam;
  private styleId: MapStyleId; private dark: boolean; private projection: 'globe' | 'mercator';
  private heatmap = false; private thumbMarkers = true;
  private pb: PlaybackState = { cursor: null, route: true, follow: true, speed: 30 };
  private route: Route | null = null;
  private hoverId: string | null = null;
  private selection: Set<string> = new Set();
  private idMap: Map<string, number> | null = null;
  private draft: AreaSelection | null = null; private applied: AreaSelection | null = null;
  private placing = false;
  private overflow = new Map<string, Cluster>();
  private lastFollow = 0; private userMovedAt = 0;
  private timers: number[] = [];

  private refreshMarkers = throttle(() => this.doRefreshMarkers(), 50);
  private emitViewport = throttle(() => this.doEmitViewport(), 160);
  private updateRoute = throttle(() => this.applyRoute(), 90);

  constructor(container: HTMLElement, private hooks: ControllerHooks, init: { styleId: MapStyleId; dark: boolean; projection: 'globe' | 'mercator'; svg: SVGSVGElement }) {
    this.styleId = init.styleId; this.dark = init.dark; this.projection = init.projection;
    const h = container.clientHeight || 800;
    const cam = lastCam ?? { center: [10, 24] as [number, number], zoom: this.overviewZoom(container.clientWidth || 1200, h), bearing: 0 };
    this.map = new MlMap({
      container,
      style: getMapStyle(init.styleId, init.dark, { projection: init.projection }),
      center: cam.center, zoom: cam.zoom, bearing: cam.bearing,
      minZoom: Math.max(0.4, Math.log2(h / 512) - 0.05), maxZoom: 19, maxPitch: 0, pitchWithRotate: false,
      attributionControl: false, renderWorldCopies: true, fadeDuration: 120,
      canvasContextAttributes: { antialias: true },
    });
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.touchPitch.disable();
    this.markers = new MarkerLayer(this.map, {
      click: (c) => this.onClusterClick(c),
      hover: (id) => this.hooks.hover(id),
    });
    this.draw = new DrawTool(this.map, init.svg, { onDone: (p) => this.hooks.drawn(p), onToolChange: (t) => this.hooks.toolChange(t) });

    const m = this.map;
    m.on('error', () => undefined); // tiles / online layers may fail while offline – the offline basemap stays
    m.on('style.load', () => { this.ready = true; this.addLayers(); this.syncAll(); });
    m.on('move', () => { this.refreshMarkers.call(); this.emitViewport.call(); });
    m.on('moveend', () => {
      const c = m.getCenter();
      lastCam = { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing() };
      this.refreshMarkers.now(); this.emitViewport.now();
    });
    m.on('resize', () => { this.refreshMarkers.call(); this.emitViewport.call(); });
    m.on('dragstart', () => { this.userMovedAt = Date.now(); });
    m.on('click', (e) => { if (this.placing) this.hooks.mapClick(e.lngLat.lat, ((e.lngLat.lng + 540) % 360) - 180); });
    m.on('click', 'iw-dots', (e) => {
      const f = e.features?.[0]; const c = f && this.overflow.get(String(f.properties?.key));
      if (c) { e.preventDefault(); this.onClusterClick(c); }
    });
    m.on('mouseenter', 'iw-dots', () => { if (!this.placing) m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'iw-dots', () => { m.getCanvas().style.cursor = ''; });
  }

  // ------------------------------------------------------------------ style & layers

  setStyle(styleId: MapStyleId, dark: boolean, projection: 'globe' | 'mercator') {
    const sameStyle = effectiveMapStyle(styleId, dark) === effectiveMapStyle(this.styleId, this.dark);
    this.styleId = styleId; this.dark = dark;
    if (projection !== this.projection) { this.projection = projection; this.map.setProjection({ type: projection }); this.refreshMarkers.call(); }
    if (sameStyle) return;
    this.ready = false;
    this.map.setStyle(getMapStyle(styleId, dark, { projection }), { diff: false });
  }

  setProjection(p: 'globe' | 'mercator') {
    if (p === this.projection) return;
    this.projection = p;
    this.map.setProjection({ type: p });
    this.refreshMarkers.call(); this.emitViewport.call();
  }

  private before(): string | undefined { return this.map.getLayer(LABEL_LAYER_ID) ? LABEL_LAYER_ID : undefined; }

  private addLayers() {
    const m = this.map, before = this.before();
    const accent = cssVar('--accent', '#4b94ff'), select = cssVar('--select', '#ffb938');
    const halo = this.dark ? '#0b0d12' : '#ffffff';
    const src = (id: string) => m.addSource(id, { type: 'geojson', data: EMPTY_FC });
    const layer = (l: LayerSpecification) => m.addLayer(l, before);
    ['iw-heat', 'iw-area-applied', 'iw-area-draft', 'iw-route', 'iw-dots', 'iw-sel', 'iw-hover', 'iw-head'].forEach(src);

    layer({
      id: 'iw-heat', type: 'heatmap', source: 'iw-heat', layout: { visibility: this.heatmap ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 5, 0.9, 10, 1.6, 14, 2.4],
        'heatmap-radius': ['interpolate', ['exponential', 1.7], ['zoom'], 0, 5, 4, 14, 8, 26, 12, 42, 16, 70],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.92, 9, 0.85, 14, 0.2, 17, 0],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, hexA(cssVar('--heat-1'), 0), 0.1, hexA(cssVar('--heat-1'), 0.35), 0.3, hexA(cssVar('--heat-2'), 0.7), 0.52, hexA(cssVar('--heat-3'), 0.8), 0.76, hexA(cssVar('--heat-4'), 0.9), 1, cssVar('--heat-5')],
      },
    });
    layer({ id: 'iw-area-applied-fill', type: 'fill', source: 'iw-area-applied', paint: { 'fill-color': accent, 'fill-opacity': 0.05 } });
    layer({ id: 'iw-area-applied-line', type: 'line', source: 'iw-area-applied', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 1.6, 'line-dasharray': [3, 2.5] } });
    layer({ id: 'iw-area-draft-fill', type: 'fill', source: 'iw-area-draft', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } });
    layer({ id: 'iw-area-draft-line', type: 'line', source: 'iw-area-draft', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2 } });
    layer({ id: 'iw-route-casing', type: 'line', source: 'iw-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': halo, 'line-width': 5, 'line-opacity': 0.55 } });
    layer({ id: 'iw-route-line', type: 'line', source: 'iw-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2.5 } });
    layer({
      id: 'iw-dots', type: 'circle', source: 'iw-dots',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 3.5, 10, 7, 100, 12, 1000, 18],
        'circle-color': accent, 'circle-opacity': 0.82, 'circle-stroke-width': 1.2, 'circle-stroke-color': halo, 'circle-stroke-opacity': 0.9,
      },
    });
    layer({ id: 'iw-sel', type: 'circle', source: 'iw-sel', paint: { 'circle-radius': 7, 'circle-color': select, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    layer({ id: 'iw-hover-ring', type: 'circle', source: 'iw-hover', paint: { 'circle-radius': 17, 'circle-color': accent, 'circle-opacity': 0.18, 'circle-stroke-width': 2, 'circle-stroke-color': accent } });
    layer({ id: 'iw-hover', type: 'circle', source: 'iw-hover', paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': accent } });
    layer({ id: 'iw-head-ring', type: 'circle', source: 'iw-head', paint: { 'circle-radius': 12, 'circle-color': accent, 'circle-opacity': 0.22 } });
    layer({ id: 'iw-head', type: 'circle', source: 'iw-head', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-width': 2.5, 'circle-stroke-color': accent } });
  }

  private setData(id: string, data: GeoJSON.GeoJSON) { (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data); }

  private syncAll() {
    this.applyHeat(); this.applyAreas(); this.applyHover(); this.applySelection(); this.applyRoute(); this.doRefreshMarkers(); this.doEmitViewport();
  }

  // ------------------------------------------------------------------ data

  setPhotos(photos: Photo[]) {
    this.photos = photos; this.ix = new PhotoIndex(photos); this.idMap = null; this.route = null;
    if (this.ready) { this.applyHeat(); this.applyHover(); this.applySelection(); this.applyRoute(); }
    this.doRefreshMarkers(); this.emitViewport.call();
    if (!this.fitted && photos.length) this.fitPhotos(!introPlayed);
  }

  private indexOf(id: string): number {
    if (!this.idMap) { this.idMap = new Map(); this.photos.forEach((p, i) => this.idMap!.set(p.id, i)); }
    return this.idMap.get(id) ?? -1;
  }

  setHeatmap(on: boolean) { this.heatmap = on; if (this.ready) this.applyHeat(); }
  private heatKey = '';
  private applyHeat() {
    const m = this.map;
    if (!m.getLayer('iw-heat')) return;
    m.setLayoutProperty('iw-heat', 'visibility', this.heatmap ? 'visible' : 'none');
    if (!this.heatmap) { this.heatKey = ''; return; }
    const cur = this.pb.cursor;
    const start = cur == null ? 0 : this.ix.firstAtOrBefore(cur);
    const key = `${this.photos.length}:${this.photos[0]?.id}:${start}`;
    if (key === this.heatKey) return;
    this.heatKey = key;
    const f: GeoJSON.Feature[] = [];
    for (let i = start; i < this.ix.n; i++) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [this.ix.lon[i], this.ix.lat[i]] } });
    this.setData('iw-heat', { type: 'FeatureCollection', features: f });
  }

  setThumbMarkers(on: boolean) { if (on === this.thumbMarkers) return; this.thumbMarkers = on; this.markers.clear(); this.doRefreshMarkers(); }

  setHover(id: string | null) {
    this.hoverId = id; this.markers.setHover(id);
    if (this.ready) this.applyHover();
  }
  private applyHover() {
    const i = this.hoverId ? this.indexOf(this.hoverId) : -1;
    const hidden = i >= 0 && this.pb.cursor != null && this.photos[i].sortTime > this.pb.cursor;
    this.setData('iw-hover', i >= 0 && !hidden ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [this.ix.lon[i], this.ix.lat[i]] } } : EMPTY_FC);
  }

  setSelection(sel: Set<string>) { this.selection = sel; if (this.ready) this.applySelection(); }
  private applySelection() {
    const f: GeoJSON.Feature[] = [];
    if (this.selection.size && this.selection.size < 3000) {
      for (const id of this.selection) { const i = this.indexOf(id); if (i >= 0) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [this.ix.lon[i], this.ix.lat[i]] } }); }
    }
    this.setData('iw-sel', { type: 'FeatureCollection', features: f });
  }

  setAreas(draft: AreaSelection | null, applied: AreaSelection | null) { this.draft = draft; this.applied = applied; if (this.ready) this.applyAreas(); }
  private applyAreas() {
    this.setData('iw-area-draft', this.draft ? polyFeature(this.draft.polygon) : EMPTY_FC);
    this.setData('iw-area-applied', this.applied ? polyFeature(this.applied.polygon) : EMPTY_FC);
  }

  setPlacing(on: boolean) { this.placing = on; this.markers.setInteractive(!on); this.map.getCanvasContainer().classList.toggle('mp-placing', on); }

  setTool(t: DrawToolId | null) { this.draw?.setTool(t); }
  get tool() { return this.draw?.active ?? null; }

  // ------------------------------------------------------------------ playback

  setPlayback(pb: PlaybackState) {
    const wasActive = this.pb.cursor != null;
    const routeChanged = pb.route !== this.pb.route;
    this.pb = pb;
    const active = pb.cursor != null;
    if (active !== wasActive || routeChanged) { this.markers.clear(); }
    this.refreshMarkers.call();
    this.updateRoute.call();
    if (active && this.heatmap) this.applyHeat();
    if (!active && wasActive) this.heatKey = '';
    if (!active && wasActive && this.heatmap) this.applyHeat();
    if (active && pb.follow) this.follow();
  }

  private applyRoute() {
    const m = this.map;
    if (!m.getSource('iw-route')) return;
    const cur = this.pb.cursor;
    if (cur == null || !this.pb.route || this.ix.n < 2) { this.setData('iw-route', EMPTY_FC); this.setData('iw-head', EMPTY_FC); return; }
    if (!this.route) {
      const n = this.ix.n, pts: LL[] = [], t: number[] = [];
      for (let i = n - 1; i >= 0; i--) { pts.push([this.ix.lon[i], this.ix.lat[i]]); t.push(this.ix.time[i]); }
      let w = 180, e = -180, s = 90, nn = -90;
      for (const p of pts) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > nn) nn = p[1]; }
      this.route = makeRoute(pts, t, Math.max(e - w, nn - s));
    }
    const line = routeUntil(this.route, cur);
    this.setData('iw-route', line.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } : EMPTY_FC);
    const head = line[line.length - 1];
    this.setData('iw-head', head ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: head } } : EMPTY_FC);
  }

  private follow() {
    const now = Date.now();
    if (now - this.lastFollow < 950 || now - this.userMovedAt < 6000) return;
    const cur = this.pb.cursor; if (cur == null) return;
    const start = this.ix.firstAtOrBefore(cur);
    if (start >= this.ix.n) return;
    this.lastFollow = now;
    const windowMs = Math.max(this.pb.speed * 86400e3 * 4, 3 * 86400e3);
    let w = 180, s = 90, e = -180, n = -90, cnt = 0;
    const latest = this.ix.time[start];
    for (let i = start; i < this.ix.n && cnt < 40 && this.ix.time[i] >= latest - windowMs; i++, cnt++) {
      const lo = this.ix.lon[i], la = this.ix.lat[i];
      if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la;
    }
    const m = this.map;
    const cam = m.cameraForBounds([[w, s], [e, n]], { padding: { top: 120, bottom: 200, left: 120, right: 120 }, maxZoom: 10 });
    const zoom = Math.max(2.2, Math.min(10, cam?.zoom ?? 6));
    const dur = prefersReducedMotion() ? 0 : 1100;
    m.easeTo({ center: [(w + e) / 2, (s + n) / 2], zoom: Math.abs(zoom - m.getZoom()) < 0.35 ? m.getZoom() : zoom, duration: dur, essential: false });
  }

  // ------------------------------------------------------------------ markers / clusters

  private doRefreshMarkers() {
    if (this.destroyed || !this.ready) return;
    const m = this.map, ix = this.ix;
    const z = m.getZoom();
    const Z = Math.max(0, Math.min(19, Math.round(z)));
    const globeWide = this.projection === 'globe' && z < 5.5;
    const cur = this.pb.cursor;
    const start = cur == null ? 0 : ix.firstAtOrBefore(cur);
    let bounds: [number, number, number, number] | null = null;
    if (!globeWide) {
      const b = m.getBounds();
      const dx = (b.getEast() - b.getWest()) * 0.12, dy = (b.getNorth() - b.getSouth()) * 0.12;
      bounds = [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
    }
    let clusters = clusterize(ix, { zoom: Z, cellPx: 72, minDistPx: this.thumbMarkers ? 60 : 36, bounds, start });
    if (this.projection === 'globe' && z < 6) {
      const c = m.getCenter();
      clusters = clusters.filter((k) => angularDistance(c.lng, c.lat, k.lon, k.lat) < 78);
    }
    const playback = cur != null ? { cursor: cur, windowMs: Math.max(this.pb.speed * 86400e3 * 3, 5 * 86400e3) } : null;
    if (playback) clusters.sort((a, b) => (ix.time[b.newest] >= cur! - playback.windowMs ? 1 : 0) - (ix.time[a.newest] >= cur! - playback.windowMs ? 1 : 0) || b.count - a.count);
    else clusters.sort((a, b) => b.count - a.count);
    const limit = this.thumbMarkers ? 80 : 140;
    const top = clusters.slice(0, limit), rest = clusters.slice(limit);
    const mode: MarkerMode = this.thumbMarkers ? 'thumb' : 'dot';
    this.markers.update(top, this.photos, mode, playback);
    this.overflow.clear();
    const feats: GeoJSON.Feature[] = [];
    for (const c of rest.slice(0, 1500)) { this.overflow.set(c.key, c); feats.push({ type: 'Feature', properties: { n: c.count, key: c.key }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } }); }
    this.setData('iw-dots', feats.length || this.hadOverflow ? { type: 'FeatureCollection', features: feats } : EMPTY_FC);
    this.hadOverflow = feats.length > 0;
  }
  private hadOverflow = false;

  /** Fires with indices of photos inside the viewport. */
  private doEmitViewport() {
    if (this.destroyed) return;
    const m = this.map, b = m.getBounds(), z = m.getZoom();
    const cur = this.pb.cursor;
    const start = cur == null ? 0 : this.ix.firstAtOrBefore(cur);
    let w = b.getWest(), e = b.getEast();
    if (e - w >= 360) { w = -180; e = 180; } else { w = ((w + 540) % 360) - 180; e = ((e + 540) % 360) - 180; }
    let inView: number[];
    if (w <= e) inView = this.ix.inBox(w, b.getSouth(), e, b.getNorth(), start);
    else inView = [...this.ix.inBox(w, b.getSouth(), 180, b.getNorth(), start), ...this.ix.inBox(-180, b.getSouth(), e, b.getNorth(), start)].sort((a, c) => a - c);
    if (this.projection === 'globe' && z < 6) {
      const c = m.getCenter();
      inView = inView.filter((i) => angularDistance(c.lng, c.lat, this.ix.lon[i], this.ix.lat[i]) < 80);
    }
    this.hooks.viewport({ bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: z, bearing: m.getBearing(), photos: this.photos, inView });
  }

  // ------------------------------------------------------------------ interaction

  private spot(lon: number, lat: number, px: number): number[] {
    const degPerPx = 360 / (512 * 2 ** this.map.getZoom());
    const rl = degPerPx * px, ra = degPerPx * px * Math.cos((lat * Math.PI) / 180);
    const cur = this.pb.cursor;
    return this.ix.inBox(lon - rl / Math.max(0.05, Math.cos((lat * Math.PI) / 180)), lat - ra, lon + rl / Math.max(0.05, Math.cos((lat * Math.PI) / 180)), lat + ra, cur == null ? 0 : this.ix.firstAtOrBefore(cur));
  }

  private openIdx(list: number[], preferred: number) {
    if (!list.length) return;
    const ids = list.map((i) => this.photos[i].id);
    const at = Math.max(0, list.indexOf(preferred));
    this.hooks.openViewer(ids, at);
  }

  private onClusterClick(c: Cluster) {
    const m = this.map;
    if (c.count === 1) { this.openIdx(this.spot(c.lon, c.lat, 10), c.rep); return; }
    const [w, s, e, n] = c.bbox;
    const cur = m.getZoom();
    const a = m.project([w, n]), b = m.project([e, s]);
    const spanPx = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (cur >= 16.3 || (spanPx < 5 && cur >= 12)) {
      const cursor = this.pb.cursor;
      const eps = 1e-7;
      this.openIdx(this.ix.inBox(w - eps, s - eps, e + eps, n + eps, cursor == null ? 0 : this.ix.firstAtOrBefore(cursor)), c.rep);
      return;
    }
    const cam = m.cameraForBounds([[w, s], [e, n]] as LngLatBoundsLike, { padding: { top: 100, bottom: 190, left: 100, right: 100 } });
    const target = Math.min(18.5, Math.max(cur + 1.4, (cam?.zoom ?? cur + 2) - 0.2));
    m.flyTo({ center: [(w + e) / 2, (s + n) / 2], zoom: target, duration: prefersReducedMotion() ? 0 : 750, essential: true, curve: 1.2 });
  }

  // ------------------------------------------------------------------ camera

  private overviewZoom(w: number, h: number): number {
    return this.projection === 'globe'
      ? Math.log2((0.78 * Math.min(h, w * 0.9) * Math.PI) / (512 * 1.38))
      : Math.log2(Math.max(w, h * 2) / 512);
  }

  zoomBy(d: number) { this.map.easeTo({ zoom: this.map.getZoom() + d, duration: prefersReducedMotion() ? 0 : 260 }); }
  resetNorth() { this.map.easeTo({ bearing: 0, pitch: 0, duration: 400 }); }

  fitPhotos(animate = true) {
    const ix = this.ix, m = this.map;
    const box = m.getContainer().getBoundingClientRect();
    this.fitted = ix.n > 0;
    const run = (center: [number, number], zoom: number) => {
      const intro = animate && !introPlayed && !prefersReducedMotion();
      this.timers.push(window.setTimeout(() => { introPlayed = true; }, 60));
      if (intro) {
        m.jumpTo({ center: [center[0] - 38, center[1] - 6], zoom: Math.max(0.5, zoom - 1.3), bearing: 0 });
        m.easeTo({ center, zoom, duration: 2600, essential: true, easing: (t) => 1 - Math.pow(1 - t, 3.2), padding: { top: 24, bottom: 96, left: 0, right: 0 } });
      } else if (animate && !prefersReducedMotion()) m.flyTo({ center, zoom, duration: 1400, essential: true, padding: { top: 24, bottom: 96, left: 0, right: 0 } });
      else m.jumpTo({ center, zoom, padding: { top: 24, bottom: 96, left: 0, right: 0 } });
    };
    if (!ix.n) { run([10, 26], this.overviewZoom(box.width, box.height)); return; }
    let w = 180, s = 90, e = -180, n = -90, sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < ix.n; i++) {
      const lo = ix.lon[i], la = ix.lat[i];
      if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la;
      const φ = (la * Math.PI) / 180, λ = (lo * Math.PI) / 180;
      sx += Math.cos(φ) * Math.cos(λ); sy += Math.cos(φ) * Math.sin(λ); sz += Math.sin(φ);
    }
    const span = Math.max(e - w, (n - s) * 1.4);
    if (span > 95) {
      const lon = (Math.atan2(sy, sx) * 180) / Math.PI, lat = (Math.atan2(sz, Math.hypot(sx, sy)) * 180) / Math.PI;
      run([lon, Math.max(-25, Math.min(40, lat * 0.7))], this.overviewZoom(box.width, box.height));
      return;
    }
    const cam = m.cameraForBounds([[w, s], [e, n]], { padding: PAD, maxZoom: 14 });
    run([(w + e) / 2, (s + n) / 2], cam?.zoom ?? 4);
  }

  flyToRequest(r: { bbox?: [number, number, number, number]; center?: [number, number]; zoom?: number }) {
    const m = this.map, dur = prefersReducedMotion() ? 0 : 1500;
    if (r.bbox) m.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: PAD, maxZoom: r.zoom ?? 13, duration: dur, essential: true });
    else if (r.center) m.flyTo({ center: r.center, zoom: r.zoom ?? 9, duration: dur, essential: true });
  }

  destroy() {
    this.destroyed = true;
    this.refreshMarkers.cancel(); this.emitViewport.cancel(); this.updateRoute.cancel();
    this.timers.forEach(clearTimeout);
    this.draw?.destroy(); this.markers.clear();
    try { this.map.remove(); } catch { /* ignore */ }
  }
}
