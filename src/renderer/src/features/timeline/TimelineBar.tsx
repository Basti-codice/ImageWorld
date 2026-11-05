import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Crosshair, Pause, Play, Route, Square, ChevronDown, ZoomOut } from 'lucide-react';
import './timeline.css';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useDerived } from '@/state/derived';
import { useLang, useT, tn, currentLocale } from '@/i18n';
import { IconButton, Segmented } from '@/ui';
import { fmtDate } from '@/lib/format';
import { detectTrips, type Trip } from '@/lib/trips';
import { usePlayback } from './playback';
import TimelineChart from './TimelineChart';
import {
  DAY, buildIndex, endOfUnit, floorUnit, formatRange, localNowAsUtc, lowerBound, presets, sameRange, upperBound, countBetween,
  type Range, type TimeIndex,
} from './model';

const SPEEDS = [1, 7, 30, 90, 365];

/* ------------------------------------------------------------- trips hook */

/** trips come from the WHOLE library (home inference needs it), then are limited to those that still have photos under the active filters */
function useTrips(filteredNoRange: ReturnType<typeof useDerived.getState>['filteredNoRange']): Trip[] {
  const photos = useLibrary((s) => s.photos);
  const lang = useLang((s) => s.lang);
  const [all, setAll] = useState<Trip[]>([]);
  useEffect(() => {
    const id = setTimeout(() => setAll(detectTrips(photos, { lang })), photos.length > 3000 ? 350 : 0);
    return () => clearTimeout(id);
  }, [photos, lang]);
  return useMemo(() => {
    if (!all.length || filteredNoRange.length >= photos.length) return all;
    const ids = new Set<string>();
    for (const p of filteredNoRange) ids.add(p.id);
    return all.filter((tr) => tr.photoIds.some((id) => ids.has(id)));
  }, [all, filteredNoRange, photos]);
}

/* ---------------------------------------------------------- playback loop */

function usePlaybackLoop(bounds: Range | null) {
  const ref = useRef(bounds);
  ref.current = bounds;
  const playing = usePlayback((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const pb = usePlayback.getState(), b = ref.current;
      if (!b) { pb.setPlaying(false); return; }
      const dt = Math.min(now - last, 100); last = now;
      const end = Math.max(b[1], b[0] + DAY);
      let c = (pb.cursor ?? b[0]) + (dt / 1000) * pb.speed * DAY;
      if (c < b[0]) c = b[0];
      if (c >= end) { pb.setCursor(end); pb.setPlaying(false); return; }
      pb.setCursor(c);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onHidden = () => { if (document.hidden) usePlayback.getState().setPlaying(false); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onHidden); };
  }, [playing]);
  // leaving the view / hiding the bar ends the journey so the map shows everything again
  useEffect(() => () => usePlayback.getState().stop(), []);
}

/* ------------------------------------------------------------- sub parts */

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return y && m && d ? Date.UTC(y, m - 1, d) : NaN; };

function CustomRange({ ix, range, active }: { ix: TimeIndex | null; range: Range | null; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const from = range?.[0] ?? ix?.first ?? Date.now(), to = range?.[1] ?? ix?.last ?? Date.now();
  const set = (a: number, b: number) => { if (Number.isNaN(a) || Number.isNaN(b)) return; useUi.getState().setFilters({ range: [Math.min(a, b), Math.max(a, b) + DAY - 1] }); };
  return (
    <div className="tl-custom" ref={rootRef}>
      <button className="chip" aria-pressed={active} aria-expanded={open} onClick={() => setOpen((o) => !o)}><CalendarRange size={14} strokeWidth={1.75} />{t('timeline.preset.custom')}</button>
      {open && (
        <div className="tl-pop" role="dialog" aria-label={t('timeline.preset.custom')}>
          <label><span>{t('timeline.custom.from')}</span><input className="field" type="date" value={isoDay(from)} max={isoDay(to)} onChange={(e) => set(parseDay(e.target.value), floorUnit(to, 'day'))} /></label>
          <label><span>{t('timeline.custom.to')}</span><input className="field" type="date" value={isoDay(to)} min={isoDay(from)} onChange={(e) => set(floorUnit(from, 'day'), parseDay(e.target.value))} /></label>
          <button className="tl-pop__reset" onClick={() => { useUi.getState().setFilters({ range: null }); setOpen(false); }}>{t('timeline.custom.reset')}</button>
        </div>
      )}
    </div>
  );
}

function Readout({ ix, bounds }: { ix: TimeIndex | null; bounds: Range | null }) {
  const t = useT();
  const cursor = usePlayback((s) => s.cursor);
  if (cursor == null) return null;
  const short = bounds && bounds[1] - bounds[0] < 3 * DAY;
  const date = fmtDate(cursor, short ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } : undefined);
  let progress = '';
  if (ix && bounds) {
    const lo = lowerBound(ix.geoTimes, bounds[0]);
    progress = t('timeline.progress', { a: new Intl.NumberFormat(currentLocale()).format(Math.max(0, upperBound(ix.geoTimes, cursor) - lo)), b: new Intl.NumberFormat(currentLocale()).format(Math.max(0, upperBound(ix.geoTimes, bounds[1]) - lo)) });
  }
  return <div className="tl-readout" aria-live="off"><span className="tl-readout__date">{date}</span><span className="tl-readout__sub">{progress}</span></div>;
}

/* ------------------------------------------------------------------ main */

export default function TimelineBar() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const locale = currentLocale();
  const filteredNoRange = useDerived((s) => s.filteredNoRange);
  const total = useDerived((s) => s.filtered.length);
  const range = useUi((s) => s.filters.range);
  const setSettings = useLibrary((s) => s.setSettings);
  const { playing, speed, route, follow, cursor } = usePlayback();
  const [zoomed, setZoomed] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  const ix = useMemo(() => buildIndex(filteredNoRange), [filteredNoRange]);
  const trips = useTrips(filteredNoRange);

  /** journey bounds: first / last located photo inside the current range (or the whole filtered library) */
  const bounds = useMemo<Range | null>(() => {
    if (!ix || !ix.geoTimes.length) return null;
    const g = ix.geoTimes;
    const lo = range ? lowerBound(g, range[0]) : 0, hi = (range ? upperBound(g, range[1]) : g.length) - 1;
    return hi < lo ? null : [g[lo], g[hi]];
  }, [ix, range]);
  usePlaybackLoop(bounds);

  // keep the cursor inside the bounds when the range changes under a running/paused journey
  useEffect(() => {
    const pb = usePlayback.getState();
    if (pb.cursor == null) return;
    if (!bounds) { pb.stop(); return; }
    const end = Math.max(bounds[1], bounds[0] + DAY);
    if (pb.cursor < bounds[0]) pb.setCursor(bounds[0]);
    else if (pb.cursor > end) { pb.setCursor(end); pb.setPlaying(false); }
  }, [bounds]);

  const togglePlay = () => {
    const pb = usePlayback.getState();
    if (pb.playing) { pb.setPlaying(false); return; }
    if (!bounds) return;
    const end = Math.max(bounds[1], bounds[0] + DAY);
    let c = pb.cursor;
    if (c == null || c < bounds[0] || c >= end - 1) c = bounds[0];
    pb.setCursor(c); pb.setPlaying(true);
  };

  const pres = useMemo(() => {
    const now = localNowAsUtc();
    return presets(now).filter((p) => p.id === 'all' || (ix && p.range && countBetween(ix, p.range[0], p.range[1]) > 0));
  }, [ix]);
  const presetActive = pres.some((p) => sameRange(p.range, range));

  const rangeText = range
    ? formatRange(range[0], range[1], locale)
    : ix ? formatRange(floorUnit(ix.first, 'month'), endOfUnit(ix.last, 'month'), locale) : '';

  const hide = () => {
    void setSettings({ timelineVisible: false });
    useUi.getState().toast(t('timeline.hidden'), { action: { label: t('timeline.show'), run: () => void useLibrary.getState().setSettings({ timelineVisible: true }) } });
  };
  const onZoomed = useCallback((z: boolean) => setZoomed(z), []);
  void lang;

  const journey = cursor != null;

  return (
    <section className="tl" aria-label={t('timeline.title')}>
      <header className="tl-head">
        {journey ? <Readout ix={ix} bounds={bounds} /> : (
          <>
            <div className="tl-summary">
              <b>{tn('timeline.photos', total)}</b>
              {rangeText && <><i className="tl-sep" /><span className="tl-summary__range">{rangeText}</span></>}
            </div>
            <div className="tl-presets" role="group" aria-label={t('timeline.preset.custom')}>
              {pres.map((p) => (
                <button key={p.id} className="chip" aria-pressed={sameRange(p.range, range)} onClick={() => useUi.getState().setFilters({ range: p.range })}>{t(`timeline.preset.${p.id}`)}</button>
              ))}
            </div>
            <CustomRange ix={ix} range={range} active={!!range && !presetActive} />
          </>
        )}
        <span className="tl-spacer" />
        {zoomed && <IconButton size="sm" label={t('timeline.zoomFit')} onClick={() => setFitSignal((n) => n + 1)}><ZoomOut size={16} strokeWidth={1.75} /></IconButton>}
        <div className="tl-transport">
          {journey && <IconButton size="sm" label={t('timeline.stop')} onClick={() => usePlayback.getState().stop()}><Square size={14} strokeWidth={1.75} /></IconButton>}
          <button className="tl-play" disabled={!bounds} aria-label={playing ? t('timeline.pause') : t('timeline.play')} title={bounds ? (playing ? t('timeline.pause') : t('timeline.play')) : t('timeline.noGeo')} onClick={togglePlay}>
            {playing ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} style={{ marginLeft: 1 }} />}
          </button>
          <div className="tl-speed" title={t('timeline.speed')}>
            <Segmented
              value={String(speed)}
              options={SPEEDS.map((n) => ({ value: String(n), label: `${n}×`, title: tn('timeline.speed', n) }))}
              onChange={(v) => usePlayback.getState().setSpeed(Number(v))}
            />
          </div>
          <IconButton size="sm" label={t('timeline.route')} active={route} aria-pressed={route} onClick={() => usePlayback.getState().setRoute(!route)}><Route size={16} strokeWidth={1.75} /></IconButton>
          <IconButton size="sm" label={t('timeline.follow')} active={follow} aria-pressed={follow} onClick={() => usePlayback.getState().setFollow(!follow)}><Crosshair size={16} strokeWidth={1.75} /></IconButton>
        </div>
        <IconButton size="sm" label={t('timeline.hide')} onClick={hide}><ChevronDown size={16} strokeWidth={1.75} /></IconButton>
      </header>
      <div className="tl-body">
        <TimelineChart ix={ix} trips={trips} bounds={bounds} onZoomedChange={onZoomed} fitSignal={fitSignal} />
      </div>
    </section>
  );
}
