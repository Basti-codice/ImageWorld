import type { Polygon, Photo, AreaSelection } from '@shared/types';

/** Ray-casting point-in-polygon, polygon in [lon, lat]. */
export function pointInPolygon(lon: number, lat: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBBox(poly: Polygon): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of poly) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

export function photoInArea(p: Photo, area: AreaSelection): boolean {
  if (p.lat == null || p.lon == null) return false;
  if (area.from != null && p.sortTime < area.from) return false;
  if (area.to != null && p.sortTime > area.to) return false;
  return pointInPolygon(p.lon, p.lat, area.polygon);
}

export function rectToPolygon(w: number, s: number, e: number, n: number): Polygon {
  return [[w, s], [e, s], [e, n], [w, n]];
}

export function circleToPolygon(lon: number, lat: number, radiusKm: number, steps = 64): Polygon {
  const out: Polygon = [];
  const dLat = radiusKm / 110.574;
  const dLon = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
