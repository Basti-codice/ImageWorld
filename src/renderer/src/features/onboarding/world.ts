/* Decorative dotted world for the welcome screen – drawn from the bundled world-atlas, no external assets.
 * Equal Earth projection (Šavrič et al. 2018), dots sampled on a regular screen grid so density is uniform. */
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, K = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

/** projected extent of the Equal Earth map (x: ±X_MAX, y: ±Y_MAX) */
export const X_MAX = 2.7066, Y_MAX = 1.3171;

export function project(lon: number, lat: number): [number, number] {
  const th = Math.asin(K * Math.sin(lat * RAD)), t2 = th * th, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(th)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, -y]; // y down
}

type Ring = Array<[number, number]>;
interface Poly { rings: Ring[]; minX: number; maxX: number; minY: number; maxY: number }

let polys: Poly[] | null = null;
function land(): Poly[] {
  if (polys) return polys;
  const topo = landTopo as unknown as Topology;
  const fc = feature(topo, topo.objects.land as never) as unknown as Feature<MultiPolygon | Polygon> | { features: Array<Feature<MultiPolygon | Polygon>> };
  const geoms = 'features' in fc ? fc.features.map((f) => f.geometry) : [fc.geometry];
  const out: Poly[] = [];
  for (const g of geoms) {
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of list) {
      const outer = rings[0] as Ring;
      let minX = 180, maxX = -180, minY = 90, maxY = -90;
      for (const [x, y] of outer) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      out.push({ rings: rings as Ring[], minX, maxX, minY, maxY });
    }
  }
  return (polys = out);
}

function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function onLand(lon: number, lat: number) {
  for (const p of land()) {
    if (lon < p.minX || lon > p.maxX || lat < p.minY || lat > p.maxY) continue;
    let inside = false;
    for (const r of p.rings) if (inRing(lon, lat, r)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

/** Inverse of the Equal Earth y: projected y -> theta (Newton). */
function thetaFromY(y: number) {
  let th = y;
  for (let i = 0; i < 12; i++) {
    const t2 = th * th, t6 = t2 * t2 * t2;
    const f = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
    const d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    th -= f / d;
  }
  return th;
}

let cached: { d: string; step: number } | null = null;
/** SVG path of dots (use stroke-linecap: round). Coordinates in 0..1000 wide space. */
export function landDots(rows = 64): { d: string; width: number; height: number } {
  const width = 1000, height = (width * Y_MAX) / X_MAX;
  if (cached) return { ...cached, width, height };
  const scale = width / (2 * X_MAX);
  const step = (2 * Y_MAX) / rows; // projected units between dots
  let d = '';
  for (let r = 0; r <= rows; r++) {
    const y = -Y_MAX + r * step;
    const th = thetaFromY(y), t2 = th * th, t6 = t2 * t2 * t2;
    const lat = -Math.asin(Math.sin(th) / K) / RAD; // real latitude (y is down)
    if (!isFinite(lat) || lat < -58) continue; // skip Antarctica – calmer picture
    const xMax = (2 * Math.sqrt(3) * Math.PI * Math.cos(th)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
    const offset = r % 2 ? step / 2 : 0;
    for (let x = -xMax + offset; x <= xMax; x += step) {
      const lon = (x / xMax) * 180;
      if (onLand(lon, lat)) d += `M${((x + X_MAX) * scale).toFixed(1)} ${((y + Y_MAX) * scale).toFixed(1)}h0`;
    }
  }
  cached = { d, step: step * scale };
  return { d, width, height };
}

/** unique ~2° cells of the given coordinates, projected into the same 0..1000 space */
export function locationDots(coords: Array<[number, number]>, max = 700): Array<[number, number]> {
  const scale = 1000 / (2 * X_MAX);
  const seen = new Set<number>(); const out: Array<[number, number]> = [];
  for (const [lat, lon] of coords) {
    const key = Math.round(lat / 2) * 1000 + Math.round(lon / 2);
    if (seen.has(key)) continue; seen.add(key);
    const [x, y] = project(lon, lat);
    out.push([(x + X_MAX) * scale, (y + Y_MAX) * scale]);
    if (out.length >= max) break;
  }
  return out;
}
