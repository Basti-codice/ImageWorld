/**
 * Offline-first basemap (bundled Natural Earth via world-atlas) styled into a restrained cartographic look.
 *
 * CONTRACT (used by MapView, MiniMap, viewer info panel, album headers):
 *   getMapStyle(id, dark, opts?) -> StyleSpecification
 *     - 'dark' | 'light'   fully offline. NOTE: these two ids are the "standard" style and follow the APP THEME:
 *                          the `dark` argument (app theme) decides which palette is used. Use `effectiveMapStyle` if you need the resolved id.
 *     - 'voyager'          offline base (voyager palette) + CARTO Voyager raster tiles on top when online
 *     - 'satellite'        offline dark base + Esri World Imagery (+ CARTO labels) when online
 *   If online tiles fail the offline base is still complete and good looking.
 */
import { setWorkerUrl, type LayerSpecification, type SourceSpecification, type StyleSpecification } from 'maplibre-gl';
// MapLibre's default worker URL breaks once Vite pre-bundles/hashes the library – hand it a bundled worker explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, Polygon, MultiPolygon, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { feature, mesh } from 'topojson-client';
import atlas50 from 'world-atlas/countries-50m.json';
import atlas110 from 'world-atlas/countries-110m.json';
import type { MapStyleId } from '@shared/types';

try { setWorkerUrl(new URL(workerUrl, document.baseURI).href); } catch { /* keep default */ }

export const LABEL_LAYER_ID = 'iw-online-labels';
export type MapDetail = 'high' | 'low';
export interface MapStyleOptions {
  /** initial projection (default 'mercator'); MapView switches at runtime with map.setProjection */
  projection?: 'globe' | 'mercator';
  /** 'low' = 110m geometry, much lighter (MiniMap). Default 'high' (50m). */
  detail?: MapDetail;
  /** add online raster layers (default true) */
  online?: boolean;
}

/** 'dark' / 'light' always follow the app theme (that is the "Standard" map). */
export function effectiveMapStyle(id: MapStyleId, dark: boolean): MapStyleId {
  return id === 'dark' || id === 'light' ? (dark ? 'dark' : 'light') : id;
}

// ---------------------------------------------------------------- geometry (lazy, cached)

interface Geo { land: FeatureCollection; countries: FeatureCollection; borders: FeatureCollection; coast: FeatureCollection }
const geoCache: Partial<Record<MapDetail, Geo>> = {};

const hash01 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };

/** Splits lines at the antimeridian cut / pole edge so no seam artefacts are drawn. */
function stripSeams(lines: Position[][]): Position[][] {
  const out: Position[][] = [];
  for (const line of lines) {
    let cur: Position[] = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      if (i > 0) {
        const q = line[i - 1];
        const seam = (Math.abs(p[0]) > 179.99 && Math.abs(q[0]) > 179.99 && Math.sign(p[0]) === Math.sign(q[0])) || (p[1] < -89.9 && q[1] < -89.9);
        if (seam) { if (cur.length > 1) out.push(cur); cur = []; }
      }
      cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

// ---- antimeridian repair: world-atlas rings that cross ±180° contain edges spanning the whole map in planar coordinates.
type Ring = Position[];

/** Sutherland–Hodgman clip of a ring against x >= x0 && x <= x1 */
function clipStrip(ring: Ring, x0: number, x1: number): Ring {
  const half = (pts: Ring, keep: (x: number) => boolean, at: number): Ring => {
    const out: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = keep(a[0]), ib = keep(b[0]);
      if (ia) out.push(a);
      if (ia !== ib) { const f = (at - a[0]) / (b[0] - a[0]); out.push([at, a[1] + (b[1] - a[1]) * f]); }
    }
    return out;
  };
  return half(half(ring, (x) => x >= x0, x0), (x) => x <= x1, x1);
}

function fixPolygon(rings: Ring[]): Ring[][] {
  const pole = (r: Ring) => r.every((p) => Math.abs(p[1]) > 89.9);
  const real = rings.filter((r) => !pole(r));
  const jumps = (r: Ring) => r.some((p, i) => i > 0 && Math.abs(p[0] - r[i - 1][0]) > 180);
  if (!real.some(jumps)) return [real];
  const polys: Ring[][] = [];
  for (const r of real) {
    if (!jumps(r)) { polys.push([r]); continue; }
    const u: Ring = [];
    let off = 0;
    r.forEach((p, i) => { if (i > 0) { const d = p[0] + off - u[i - 1][0]; if (d > 180) off -= 360; else if (d < -180) off += 360; } u.push([p[0] + off, p[1]]); });
    const a = u[0], b = u[u.length - 1];
    let ring = u;
    if (Math.abs(b[0] - a[0]) > 180) { // encircles a pole (Antarctica): close the outline along the pole
      const lat = u.reduce((m, p) => m + p[1], 0) / u.length < 0 ? -90 : 90;
      ring = [...u.slice(0, -1), [b[0], lat], [a[0], lat]];
    }
    const xs = ring.map((p) => p[0]);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    for (let k = Math.floor((lo + 180) / 360); k <= Math.floor((hi + 180) / 360); k++) {
      const part = clipStrip(ring.map((p) => [p[0] - 360 * k, p[1]]), -180, 180);
      if (part.length >= 3) { part.push(part[0]); polys.push([part]); }
    }
  }
  return polys;
}

function fixFeatureGeometry(g: Geometry): Geometry {
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return g;
  const src = g.type === 'Polygon' ? [(g as Polygon).coordinates] : (g as MultiPolygon).coordinates;
  const out: Position[][][] = [];
  for (const poly of src) out.push(...fixPolygon(poly));
  return { type: 'MultiPolygon', coordinates: out };
}

function toLines(g: Geometry | null): Position[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [(g as LineString).coordinates];
  if (g.type === 'MultiLineString') return (g as MultiLineString).coordinates;
  if (g.type === 'Polygon') return (g as Polygon).coordinates;
  if (g.type === 'MultiPolygon') return (g as MultiPolygon).coordinates.flat();
  return [];
}

function lineFC(lines: Position[][]): FeatureCollection {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: stripSeams(lines) } }] };
}

function buildGeo(detail: MapDetail): Geo {
  const topo = (detail === 'high' ? atlas50 : atlas110) as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  const landF = feature(topo, topo.objects.land) as unknown as Feature | FeatureCollection;
  const land0: FeatureCollection = landF.type === 'FeatureCollection' ? landF : { type: 'FeatureCollection', features: [landF] };
  const land: FeatureCollection = { type: 'FeatureCollection', features: land0.features.map((f) => ({ ...f, geometry: fixFeatureGeometry(f.geometry) })) };
  const cf0 = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
  const cf: FeatureCollection = { type: 'FeatureCollection', features: cf0.features.map((f) => ({ ...f, geometry: fixFeatureGeometry(f.geometry) })) };
  // per-country tonal variation `v` in 0..1 (deterministic) – keeps neighbouring countries apart without borders shouting
  const countries: FeatureCollection = { type: 'FeatureCollection', features: cf.features.map((f) => ({ ...f, properties: { v: hash01(String(f.id ?? f.properties?.name ?? '')) } })) };
  const borders = lineFC(toLines(mesh(topo, topo.objects.countries, (a, b) => a !== b) as unknown as Geometry));
  const coast = lineFC(land.features.flatMap((f) => toLines(f.geometry)));
  return { land, countries, borders, coast };
}
const getGeo = (d: MapDetail) => (geoCache[d] ??= buildGeo(d));

let graticuleCache: FeatureCollection | null = null;
function graticule(): FeatureCollection {
  if (graticuleCache) return graticuleCache;
  const lines: Position[][] = [];
  for (let lon = -180; lon <= 180; lon += 15) { const l: Position[] = []; for (let lat = -90; lat <= 90; lat += 3) l.push([lon, lat]); lines.push(l); }
  for (let lat = -75; lat <= 75; lat += 15) { const l: Position[] = []; for (let lon = -180; lon <= 180; lon += 3) l.push([lon, lat]); lines.push(l); }
  return (graticuleCache = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] });
}

// ---------------------------------------------------------------- palettes

interface Palette {
  ocean: string; land: string; landA: string; landB: string; coast: string; border: string; grat: string; gratOpacity: number;
  skyColor: string; horizon: string; space: string;
}
const DARK: Palette = {
  ocean: '#060910', land: '#1a2231', landA: '#1a2231', landB: '#212b3d', coast: '#3a4a66', border: '#303c52', grat: '#7c93c0', gratOpacity: 0.09,
  skyColor: '#0a1020', horizon: '#27447a', space: '#04060a',
};
const LIGHT: Palette = {
  ocean: '#d6e2ec', land: '#f6f4ee', landA: '#f6f4ee', landB: '#efece4', coast: '#a5b3c2', border: '#c9ced6', grat: '#5d7ca6', gratOpacity: 0.16,
  skyColor: '#cfe0f1', horizon: '#eaf2fb', space: '#eef2f7',
};
const VOYAGER: Palette = { ...LIGHT, ocean: '#aed3e0', land: '#f2efe8', landA: '#f2efe8', landB: '#ede9e0', coast: '#8fb3c4', border: '#c2c7cc' };
const SATELLITE: Palette = { ...DARK, ocean: '#05080d', land: '#0e141d', landA: '#0e141d', landB: '#111823', coast: '#3a4a63', border: '#7d8aa3', gratOpacity: 0 };

/** Colour of the "space" / flat-map surround behind the canvas for a given style – used by the container CSS. */
export function mapBackdrop(id: MapStyleId, dark: boolean, projection: 'globe' | 'mercator'): string {
  const p = paletteFor(effectiveMapStyle(id, dark));
  return projection === 'globe' ? p.space : p.ocean;
}
function paletteFor(id: MapStyleId): Palette { return id === 'dark' ? DARK : id === 'light' ? LIGHT : id === 'voyager' ? VOYAGER : SATELLITE; }

// ---------------------------------------------------------------- online layers

const CARTO_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
const ESRI_ATTR = 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const NE_ATTR = 'Natural Earth';

const retina = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 1.25 ? '@2x' : '');
const carto = (kind: string) => ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/${kind}/{z}/{x}/{y}${retina()}.png`);

function rasterSource(tiles: string[], attribution: string, maxzoom: number, tileSize = 256): SourceSpecification {
  return { type: 'raster', tiles, tileSize, maxzoom, attribution };
}

// ---------------------------------------------------------------- style

export function getMapStyle(id: MapStyleId, dark: boolean, opts: MapStyleOptions = {}): StyleSpecification {
  const { projection = 'mercator', detail = 'high', online = true } = opts;
  const sid = effectiveMapStyle(id, dark);
  const p = paletteFor(sid);
  const g = getGeo(detail);
  const isDarkBase = sid === 'dark' || sid === 'satellite';

  const sources: Record<string, SourceSpecification> = {
    'iw-land': { type: 'geojson', data: g.land, maxzoom: 7, attribution: NE_ATTR },
    'iw-countries': { type: 'geojson', data: g.countries, maxzoom: 7 },
    'iw-borders': { type: 'geojson', data: g.borders, maxzoom: 7 },
    'iw-coast': { type: 'geojson', data: g.coast, maxzoom: 7 },
    'iw-graticule': { type: 'geojson', data: graticule(), maxzoom: 4 },
  };

  const layers: LayerSpecification[] = [
    { id: 'iw-ocean', type: 'background', paint: { 'background-color': p.ocean } },
    { id: 'iw-land', type: 'fill', source: 'iw-land', paint: { 'fill-color': p.land, 'fill-antialias': true } },
    { id: 'iw-countries', type: 'fill', source: 'iw-countries', paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'v'], 0, p.landA, 1, p.landB], 'fill-antialias': false } },
  ];

  if (online && sid === 'satellite') {
    sources['iw-online-base'] = rasterSource(['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], ESRI_ATTR, 19);
    layers.push({ id: 'iw-online-base', type: 'raster', source: 'iw-online-base', paint: { 'raster-fade-duration': 400, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.92, 4, 1] } });
  } else if (online && sid === 'voyager') {
    sources['iw-online-base'] = rasterSource(carto('rastertiles/voyager'), CARTO_ATTR, 20);
    layers.push({ id: 'iw-online-base', type: 'raster', source: 'iw-online-base', paint: { 'raster-fade-duration': 300 } });
  }

  layers.push(
    { id: 'iw-graticule', type: 'line', source: 'iw-graticule', paint: { 'line-color': p.grat, 'line-width': 0.6, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, p.gratOpacity, 4, p.gratOpacity, 6, 0] } },
    { id: 'iw-borders', type: 'line', source: 'iw-borders', layout: { 'line-join': 'round' }, paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 0.9, 8, 1.4], 'line-opacity': sid === 'satellite' ? 0.45 : 0.9 } },
    { id: 'iw-coast', type: 'line', source: 'iw-coast', layout: { 'line-join': 'round' }, paint: { 'line-color': p.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 0.8, 8, 1.2], 'line-opacity': sid === 'satellite' ? 0.35 : 0.85 } },
  );

  if (online && (sid === 'dark' || sid === 'light')) {
    // roads / water detail fades in at city scale, labels on top at all scales (muted)
    const k = sid;
    sources['iw-online-detail'] = rasterSource(carto(`${k}_nolabels`), CARTO_ATTR, 20);
    layers.push({ id: 'iw-online-detail', type: 'raster', source: 'iw-online-detail', minzoom: 5, paint: { 'raster-fade-duration': 300, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7.5, 1] } });
  }
  if (online && sid !== 'voyager') {
    sources['iw-online-labels'] = rasterSource(carto(`${isDarkBase ? 'dark' : 'light'}_only_labels`), CARTO_ATTR, 20);
    layers.push({ id: LABEL_LAYER_ID, type: 'raster', source: 'iw-online-labels', paint: { 'raster-fade-duration': 300, 'raster-opacity': sid === 'satellite' ? 0.85 : 0.7 } });
  }

  return {
    version: 8,
    name: `ImageWorld ${sid}`,
    projection: { type: projection },
    sky: {
      'sky-color': p.skyColor,
      'horizon-color': p.horizon,
      'fog-color': p.skyColor,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.2,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.9, 7, 0],
    },
    sources,
    layers,
  };
}
