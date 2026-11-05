import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, MapPinOff } from 'lucide-react';
import type { Photo } from '@shared/types';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useDerived } from '@/state/derived';
import { usePlayback } from '@/features/timeline/playback';
import { useT, tn } from '@/i18n';
import { Button, EmptyState } from '@/ui';
import { effectiveMapStyle, mapBackdrop } from './basemap';
import { MapController, type Viewport } from './controller';
import type { DrawToolId } from './draw';
import { useIsDark } from './theme';
import { MapControls, ToolsBar } from './Controls';
import { SelectionCard, ViewStrip } from './Panels';
import './map.css';

let consumedFly = 0;

export default function MapView() {
  const t = useT();
  const dark = useIsDark();
  const settings = useLibrary((s) => s.settings);
  const geo = useDerived((s) => s.geo);
  const filteredCount = useDerived((s) => s.filtered.length);
  const area = useUi((s) => s.filters.area);
  const draft = useUi((s) => s.draftArea);
  const placing = useUi((s) => s.placing);
  const selection = useUi((s) => s.selection);
  const hoverId = useUi((s) => s.hoverId);
  const flyTo = useUi((s) => s.flyTo);
  const cursor = usePlayback((s) => s.cursor);
  const pbRoute = usePlayback((s) => s.route);
  const pbFollow = usePlayback((s) => s.follow);
  const pbSpeed = usePlayback((s) => s.speed);
  const libraryHasGeo = useLibrary((s) => (geo.length ? true : s.photos.some((p) => p.lat != null)));

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [tool, setTool] = useState<DrawToolId | null>(null);

  const projection = settings.mapProjection;
  const styleId = settings.mapStyle;

  // ---- create / destroy the GL map
  useEffect(() => {
    const host = hostRef.current, svg = svgRef.current;
    if (!host || !svg) return;
    let c: MapController;
    try {
      c = new MapController(host, {
        openViewer: (ids, index) => useUi.getState().openViewer(ids, index),
        hover: (id) => useUi.getState().setHoverId(id),
        viewport: (v) => setViewport(v),
        mapClick: (lat, lon) => {
          const ids = useUi.getState().placing;
          if (!ids) return;
          void useLibrary.getState().updatePhotos(ids, { location: { lat, lon } });
          useUi.getState().toast(tn('map.placing.done', ids.length), { tone: 'success' });
          useUi.getState().setPlacing(null);
        },
        toolChange: (x) => setTool(x),
        drawn: (polygon) => {
          const range = useUi.getState().filters.range;
          useUi.getState().setDraftArea({ polygon, ...(range ? { from: range[0], to: range[1] } : {}) });
        },
      }, { styleId, dark, projection, svg });
    } catch {
      setFailed(true);
      return;
    }
    ctrl.current = c;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mapCtrl = c;
    const m = c.map;
    m.getCanvas().addEventListener('webglcontextcreationfailed', () => setFailed(true));
    return () => { c.destroy(); ctrl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- state -> controller
  useEffect(() => { ctrl.current?.setStyle(styleId, dark, projection); }, [styleId, dark, projection]);
  useEffect(() => {
    const id = window.setTimeout(() => ctrl.current?.setPhotos(geo), 0);
    return () => clearTimeout(id);
  }, [geo]);
  useEffect(() => { ctrl.current?.setHeatmap(settings.heatmap); }, [settings.heatmap]);
  useEffect(() => { ctrl.current?.setThumbMarkers(settings.thumbMarkers); }, [settings.thumbMarkers]);
  useEffect(() => { ctrl.current?.setHover(hoverId); }, [hoverId]);
  useEffect(() => { ctrl.current?.setSelection(selection); }, [selection, geo]);
  useEffect(() => { ctrl.current?.setAreas(draft, area); }, [draft, area]);
  useEffect(() => { ctrl.current?.setPlacing(!!placing); if (placing) ctrl.current?.setTool(null); }, [placing]);
  useEffect(() => { ctrl.current?.setPlayback({ cursor, route: pbRoute, follow: pbFollow, speed: pbSpeed }); }, [cursor, pbRoute, pbFollow, pbSpeed]);
  useEffect(() => {
    if (!flyTo || flyTo.nonce <= consumedFly) return;
    if (Date.now() - flyTo.nonce > 5000) { consumedFly = flyTo.nonce; return; }
    consumedFly = flyTo.nonce;
    ctrl.current?.flyToRequest(flyTo);
  }, [flyTo]);

  // ---- publish viewport (throttled in the controller)
  useEffect(() => {
    if (viewport) useUi.getState().setMapBounds(viewport.bounds);
  }, [viewport]);
  useEffect(() => () => useUi.getState().setMapBounds(null), []);

  // ---- keyboard: Esc cancels tool / placing
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ctrl.current?.tool) { ctrl.current.setTool(null); e.stopPropagation(); }
      else if (useUi.getState().placing) useUi.getState().setPlacing(null);
      else if (useUi.getState().draftArea) useUi.getState().setDraftArea(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  // ---- keep the attribution above the bottom panels
  useEffect(() => {
    const el = bottomRef.current, host = hostRef.current?.parentElement;
    if (!el || !host) return;
    const ro = new ResizeObserver(() => host.style.setProperty('--mp-bottom', `${Math.round(el.getBoundingClientRect().height) + 12}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const withoutCount = Math.max(0, filteredCount - geo.length);
  const inViewPhotos = useMemo<Photo[]>(() => (viewport ? viewport.inView.map((i) => viewport.photos[i]) : []), [viewport]);
  const fit = useCallback(() => ctrl.current?.fitPhotos(true), []);

  const showWithout = () => { useUi.getState().setFilters({ location: 'without' }); useUi.getState().setView('photos'); };
  const clearArea = () => useUi.getState().setFilters({ area: null });

  if (failed) {
    return (
      <div className="mp mp--plain">
        <EmptyState icon={<MapPinOff size={28} strokeWidth={1.5} />} title={t('map.webgl.title')} hint={t('map.webgl.hint')} />
      </div>
    );
  }

  const style = effectiveMapStyle(styleId, dark);
  return (
    <div className="mp" data-projection={projection} data-style={style} data-dark={dark} style={{ ['--mp-backdrop' as string]: mapBackdrop(styleId, dark, projection) }}>
      <div ref={hostRef} className="mp__canvas" />
      <svg ref={svgRef} className="mp-draw" aria-hidden="true" />

      <div className="mp-top mp-top--left">
        <ToolsBar tool={tool} onTool={(x) => ctrl.current?.setTool(x)} disabled={!!placing} />
        {withoutCount > 0 && (
          <button className="mp-pill" onClick={showWithout} title={t('map.withoutLocation.title')}>
            <MapPinOff size={15} strokeWidth={1.75} />
            <span>{t('map.withoutLocation')}</span>
            <span className="mp-pill__n tabular">{new Intl.NumberFormat().format(withoutCount)}</span>
          </button>
        )}
      </div>

      <MapControls
        projection={projection} styleId={styleId} dark={dark} heatmap={settings.heatmap} thumbs={settings.thumbMarkers}
        bearing={viewport?.bearing ?? 0}
        onZoom={(d) => ctrl.current?.zoomBy(d)} onNorth={() => ctrl.current?.resetNorth()} onFit={fit}
        onProjection={() => void useLibrary.getState().setSettings({ mapProjection: projection === 'globe' ? 'mercator' : 'globe' })}
        onStyle={(s) => void useLibrary.getState().setSettings({ mapStyle: s })}
        onHeatmap={() => void useLibrary.getState().setSettings({ heatmap: !settings.heatmap })}
        onThumbs={() => void useLibrary.getState().setSettings({ thumbMarkers: !settings.thumbMarkers })}
      />

      <div className="mp-top mp-top--center">
        {placing && (
          <div className="mp-banner glass" role="status">
            <MapPin size={16} strokeWidth={1.75} />
            <span>{t('map.placing.hint')}</span>
            <Button size="sm" variant="ghost" onClick={() => useUi.getState().setPlacing(null)}>{t('map.placing.cancel')}</Button>
          </div>
        )}
        {!placing && tool && (
          <div className="mp-banner mp-banner--hint glass" role="status">
            <span>{t(`map.tool.${tool}.hint`)}</span><span className="mp-banner__dim">{t('map.tool.cancel')}</span>
          </div>
        )}
        {!placing && !tool && area && (
          <button className="mp-chip glass" onClick={clearArea} title={t('map.area.remove')}>
            <span className="mp-chip__dash" />
            <span>{t('map.area.active')} · {tn('map.photos', geo.length)}</span>
            <span className="mp-chip__x" aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {geo.length === 0 && (
        <div className="mp-empty glass">
          <MapPinOff size={26} strokeWidth={1.5} />
          <h3>{libraryHasGeo ? t('map.noMatch.title') : t('map.empty.title')}</h3>
          <p>{libraryHasGeo ? t('map.noMatch.hint') : t('map.empty.hint')}</p>
          {libraryHasGeo
            ? <Button onClick={() => useUi.getState().resetFilters()}>{t('map.noMatch.action')}</Button>
            : (filteredCount > 0 && <Button onClick={showWithout}>{t('map.empty.action')}</Button>)}
        </div>
      )}

      <div ref={bottomRef} className="mp-bottom" data-lift={selection.size > 0}>
        {draft && <SelectionCard area={draft} geo={geo} />}
        {geo.length > 0 && <ViewStrip photos={inViewPhotos} total={viewport?.inViewCount ?? inViewPhotos.length} />}
      </div>
    </div>
  );
}

