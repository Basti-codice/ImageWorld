import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath, geoArea, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import atlas from 'world-atlas/countries-110m.json';
import { atlasCountryCode, type CityAgg } from '@/lib/countries';
import { tn, useT } from '@/i18n';
import { useTipApi } from './charts';

interface Land { cc?: string; name: string; geo: Feature<Polygon | MultiPolygon> }

let LAND: Land[] | null = null;
function land(): Land[] {
  if (LAND) return LAND;
  const fc = feature(atlas as unknown as Topology, (atlas as any).objects.countries) as unknown as FeatureCollection<Polygon | MultiPolygon, { name: string }>;
  LAND = fc.features
    .filter((f) => String(f.id) !== '010') // no Antarctica – wasted pixels
    .map((f) => ({ cc: atlasCountryCode(f.id as string | undefined, f.properties?.name), name: f.properties?.name ?? '', geo: f as Feature<Polygon | MultiPolygon> }));
  return LAND;
}

/** largest single polygon of a (multi)polygon – used to frame countries with remote territories */
function mainPolygon(f: Feature<Polygon | MultiPolygon>): Feature<Polygon> {
  if (f.geometry.type === 'Polygon') return f as Feature<Polygon>;
  let best = f.geometry.coordinates[0], area = -1;
  for (const c of f.geometry.coordinates) {
    const a = geoArea({ type: 'Polygon', coordinates: c });
    if (a > area) { area = a; best = c; }
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: best } };
}

export interface VisitedInfo { count: number; name: string; cities: number; lat: number | null; lon: number | null }

interface Props {
  visited: Map<string, VisitedInfo>;
  /** world mode: pick a country. country mode: pick a city */
  onPickCountry?: (cc: string) => void;
  /** when set the map frames this country and shows its cities as dots */
  focus?: { cc: string; cities: CityAgg[] };
  onPickCity?: (c: CityAgg) => void;
  label: string;
  countryLabel: (cc: string, raw: string) => string;
}

const WorldMap = memo(function WorldMap({ visited, onPickCountry, focus, onPickCity, label, countryLabel }: Props) {
  const t = useT();
  const tip = useTipApi();
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    setW(Math.round(el.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const maxCount = useMemo(() => Math.max(1, ...[...visited.values()].map((v) => v.count)), [visited]);

  const model = useMemo(() => {
    if (!w) return null;
    const lands = land();
    const proj = geoNaturalEarth1();
    let h: number;
    if (focus) {
      h = Math.round(Math.min(340, Math.max(220, w * 0.46)));
      const cl = lands.find((l) => l.cc === focus.cc);
      const pts = focus.cities.filter((c) => c.lat != null).map((c) => [c.lon!, c.lat!] as [number, number]);
      const objs: GeoPermissibleObjects[] = [];
      if (cl) objs.push(mainPolygon(cl.geo));
      if (pts.length) objs.push({ type: 'MultiPoint', coordinates: pts });
      if (objs.length) proj.fitExtent([[24, 20], [w - 24, h - 20]], { type: 'GeometryCollection', geometries: objs.map((o) => (o as any).type === 'Feature' ? (o as any).geometry : o) } as GeoPermissibleObjects);
      else proj.fitExtent([[0, 0], [w, h]], { type: 'Sphere' });
    } else {
      const fc: FeatureCollection = { type: 'FeatureCollection', features: lands.map((l) => l.geo) };
      proj.fitWidth(w, fc);
      const b = geoPath(proj).bounds(fc);
      proj.translate([proj.translate()[0], proj.translate()[1] - b[0][1] + 1]);
      h = Math.ceil(b[1][1] - b[0][1] + 2);
    }
    const path = geoPath(proj);
    const items = lands.map((l) => ({ cc: l.cc, name: l.name, d: path(l.geo) ?? '' }));
    const present = new Set(lands.map((l) => l.cc).filter(Boolean) as string[]);
    const dots = !focus
      ? [...visited.entries()].filter(([cc, v]) => !present.has(cc) && v.lat != null).map(([cc, v]) => ({ cc, v, xy: proj([v.lon!, v.lat!]) as [number, number] | null })).filter((d) => d.xy)
      : [];
    const cityDots = focus ? focus.cities.filter((c) => c.lat != null).map((c) => ({ c, xy: proj([c.lon!, c.lat!]) as [number, number] })) : [];
    return { h, items, dots, cityDots };
  }, [w, focus, visited]);

  const fillFor = (n: number) => {
    const t01 = Math.log(1 + n) / Math.log(1 + maxCount);
    return `color-mix(in srgb, var(--accent) ${Math.round(52 + 48 * t01)}%, var(--land))`;
  };
  const maxCity = focus ? Math.max(1, ...focus.cities.map((c) => c.count)) : 1;

  return (
    <div ref={wrap} className="wmap" role="img" aria-label={label}>
      {model && (
        <svg viewBox={`0 0 ${w} ${model.h}`} width={w} height={model.h}>
          {model.items.map((l, i) => {
            const v = l.cc ? visited.get(l.cc) : undefined;
            if (!v || !l.cc) return <path key={i} d={l.d} className="wmap__land" />;
            const isFocus = focus?.cc === l.cc;
            const name = countryLabel(l.cc, v.name);
            return (
              <path
                key={i} d={l.d} className={`wmap__land is-visited${focus ? (isFocus ? ' is-focus' : ' is-dim') : ''}`}
                style={{ fill: focus ? undefined : fillFor(v.count) }}
                tabIndex={focus ? -1 : 0} role={focus ? undefined : 'button'} aria-label={`${name}, ${tn('common.photos', v.count)}`}
                onMouseMove={(e) => tip.show(e.clientX, e.clientY, name, tn('common.photos', v.count) + ' · ' + tn('places.cities', v.cities))}
                onMouseLeave={() => tip.hide()}
                onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); tip.show(r.left + r.width / 2, r.top + r.height / 2, name, tn('common.photos', v.count)); }}
                onBlur={() => tip.hide()}
                onClick={() => { tip.hide(); if (!focus) onPickCountry?.(l.cc!); }}
                onKeyDown={(e) => { if (!focus && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPickCountry?.(l.cc!); } }}
              />
            );
          })}
          {model.dots.map(({ cc, v, xy }) => {
            const name = countryLabel(cc, v.name);
            return (
              <circle key={cc} cx={xy![0]} cy={xy![1]} r={4} className="wmap__dot" tabIndex={0} role="button" aria-label={name}
                onMouseMove={(e) => tip.show(e.clientX, e.clientY, name, tn('common.photos', v.count))} onMouseLeave={() => tip.hide()}
                onClick={() => { tip.hide(); onPickCountry?.(cc); }} onKeyDown={(e) => { if (e.key === 'Enter') onPickCountry?.(cc); }} />
            );
          })}
          {model.cityDots.map(({ c, xy }) => (
            <circle key={c.key} cx={xy[0]} cy={xy[1]} r={4 + Math.sqrt(c.count / maxCity) * 9} className="wmap__city" tabIndex={0} role="button" aria-label={c.city}
              onMouseMove={(e) => tip.show(e.clientX, e.clientY, c.city, tn('common.photos', c.count))} onMouseLeave={() => tip.hide()}
              onClick={() => { tip.hide(); onPickCity?.(c); }} onKeyDown={(e) => { if (e.key === 'Enter') onPickCity?.(c); }} />
          ))}
        </svg>
      )}
      <span className="sr-only">{t('places.map.hint')}</span>
    </div>
  );
});
export default WorldMap;
