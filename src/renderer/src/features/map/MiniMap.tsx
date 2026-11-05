import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MlMap, type LngLatBoundsLike } from 'maplibre-gl';
import type { Photo } from '@shared/types';
import { MapPinOff } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useT } from '@/i18n';
import { effectiveMapStyle, getMapStyle } from './basemap';
import { cssVar, useIsDark } from './theme';
import { makeRoute, type LL } from './route';
import './map.css';

export interface MiniMapProps {
  photos: Photo[];
  height?: number;
  /** allow pan/zoom (default false = static decorative map that auto-fits the photos) */
  interactive?: boolean;
  /** draw chronological route between photo locations */
  route?: boolean;
  /** highlight a single photo (e.g. in the viewer info panel) */
  activeId?: string;
  className?: string;
}

// Static mini maps render ONCE into a snapshot image and release their WebGL context, so dozens of
// album headers / viewer panels never exhaust the browser's context limit. Renders are serialised.
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(job: () => Promise<T>): Promise<T> => { const p = chain.then(job, job); chain = p.catch(() => undefined); return p; };

const MAX_DOTS = 1500;

interface Pt { id: string; lon: number; lat: number; t: number }

function prepare(photos: Photo[]): Pt[] {
  const out: Pt[] = [];
  for (const p of photos) if (p.lat != null && p.lon != null) out.push({ id: p.id, lon: p.lon, lat: p.lat, t: p.sortTime });
  return out.sort((a, b) => a.t - b.t);
}

function boundsOf(pts: Pt[]): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of pts) { if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; }
  return [w, s, e, n];
}

const point = (lon: number, lat: number, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: [lon, lat] } });

function build(holder: HTMLElement, pts: Pt[], o: { dark: boolean; styleId: ReturnType<typeof effectiveMapStyle>; interactive: boolean; route: boolean; activeId?: string; width: number; height: number }): MlMap {
  const bb = boundsOf(pts);
  const span = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  const style = getMapStyle(o.styleId, o.dark, { projection: 'mercator', detail: span < 40 ? 'high' : 'low', online: true });
  const map = new MlMap({
    container: holder, style, interactive: o.interactive, attributionControl: o.interactive ? { compact: true } : false,
    fadeDuration: 0, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), renderWorldCopies: false, maxPitch: 0, dragRotate: false,
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: !o.interactive },
    ...(pts.length === 1 ? { center: [pts[0].lon, pts[0].lat] as [number, number], zoom: 6 } : { bounds: bb as LngLatBoundsLike, fitBoundsOptions: { padding: Math.min(28, Math.round(Math.min(o.width, o.height) / 5)), maxZoom: 7, duration: 0 } }),
  });
  map.on('error', () => undefined);
  map.on('load', () => {
    const accent = cssVar('--accent', '#4b94ff');
    const halo = o.dark ? '#0b0d12' : '#ffffff';
    const step = Math.max(1, Math.ceil(pts.length / MAX_DOTS));
    const dots = pts.filter((_, i) => i % step === 0);
    if (o.route && pts.length > 1) {
      const line = makeRoute(pts.map((p) => [p.lon, p.lat] as LL), pts.map((p) => p.t), span).coords;
      map.addSource('mm-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
      map.addLayer({ id: 'mm-route-casing', type: 'line', source: 'mm-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': halo, 'line-width': 4, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'mm-route', type: 'line', source: 'mm-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2 } });
    }
    map.addSource('mm-pts', { type: 'geojson', data: { type: 'FeatureCollection', features: dots.map((p) => point(p.lon, p.lat)) } });
    map.addLayer({ id: 'mm-pts', type: 'circle', source: 'mm-pts', paint: { 'circle-radius': pts.length > 200 ? 2.2 : 3.4, 'circle-color': accent, 'circle-opacity': pts.length > 200 ? 0.75 : 1, 'circle-stroke-width': pts.length > 200 ? 0 : 1.2, 'circle-stroke-color': halo } });
    const active = o.activeId ? pts.find((p) => p.id === o.activeId) : undefined;
    if (active) {
      map.addSource('mm-active', { type: 'geojson', data: point(active.lon, active.lat) });
      map.addLayer({ id: 'mm-active-ring', type: 'circle', source: 'mm-active', paint: { 'circle-radius': 11, 'circle-color': accent, 'circle-opacity': 0.22 } });
      map.addLayer({ id: 'mm-active', type: 'circle', source: 'mm-active', paint: { 'circle-radius': 5.5, 'circle-color': accent, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    }
  });
  return map;
}

export function MiniMap({ photos, height = 160, interactive = false, route = false, activeId, className }: MiniMapProps) {
  const t = useT();
  const dark = useIsDark();
  const mapStyle = useLibrary((s) => s.settings.mapStyle);
  const styleId = effectiveMapStyle(mapStyle, dark);
  const pts = useMemo(() => prepare(photos), [photos]);
  const sig = useMemo(() => `${pts.length}:${pts[0]?.id}:${pts[pts.length - 1]?.id}:${pts.length ? pts[pts.length >> 1].id : ''}`, [pts]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [snap, setSnap] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth / 24) * 24));
    ro.observe(el); setWidth(Math.round(el.clientWidth / 24) * 24);
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { rootMargin: '240px' });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  const key = `${sig}|${dark}|${styleId}|${route}|${activeId ?? ''}|${interactive}|${width}|${height}`;
  useEffect(() => {
    if (!visible || !width || !pts.length) return;
    const el = wrapRef.current; if (!el) return;
    if (snap?.key === key) return;
    let cancelled = false;
    let map: MlMap | null = null;
    const holder = document.createElement('div');
    holder.className = 'mm__holder';
    if (!interactive) holder.style.opacity = '0';
    const run = async () => {
      if (cancelled) return;
      el.appendChild(holder);
      try { map = build(holder, pts, { dark, styleId, interactive, route, activeId, width, height }); } catch { holder.remove(); return; }
      if (interactive) { setSnap(null); return; }
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        const timer = setTimeout(done, 4500);
        map!.once('load', () => map!.once('idle', () => { clearTimeout(timer); done(); }));
        map!.on('webglcontextlost', done);
      });
      if (!cancelled && map) {
        try { const url = map.getCanvas().toDataURL('image/png'); setSnap({ key, url }); } catch { /* keep live map */ }
      }
      map?.remove(); map = null; holder.remove();
    };
    if (interactive) { void run(); } else { void enqueue(run); }
    return () => { cancelled = true; map?.remove(); map = null; holder.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);

  const showSnap = !interactive && !!snap && pts.length > 0;
  return (
    <div ref={wrapRef} className={`mm ${className ?? ''}`} style={{ height }} role="img" aria-label={t('map.mini.aria')} data-dark={dark}>
      {!pts.length && <div className="mm__empty"><MapPinOff size={16} strokeWidth={1.75} />{t('map.mini.noLocation')}</div>}
      {showSnap && <img className="mm__snap" src={snap!.url} alt="" draggable={false} />}
    </div>
  );
}
