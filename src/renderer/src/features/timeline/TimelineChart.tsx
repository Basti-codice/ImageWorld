import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useUi } from '@/state/ui';
import { useT, tn, useLang, currentLocale } from '@/i18n';
import type { Trip } from '@/lib/trips';
import { usePlayback } from './playback';
import {
  DAY, buildBuckets, buildTicks, clampView, endOfUnit, fitView, floorUnit, formatBucket, formatRange, nextUnit, pickUnit, sameRange, viewLimits, MIN_SPAN,
  type Bucket, type Range, type TimeIndex, type Unit,
} from './model';

/** vertical layout of the plot (px): bars | axis. The trips lane is DOM below. */
const BH = 64;
const AXIS = 18;
export const PLOT_H = BH + AXIS;
const EDGE = 7;

interface Colors { accent: string; accentHover: string; text2: string; text3: string; border: string; borderStrong: string; font: string }
function readColors(): Colors {
  const s = getComputedStyle(document.documentElement);
  const g = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
  return { accent: g('--accent', '#4b94ff'), accentHover: g('--accent-hover', '#6aa6ff'), text2: g('--text-2', '#a4acbb'), text3: g('--text-3', '#7f879a'), border: g('--border', 'rgba(255,255,255,.07)'), borderStrong: g('--border-strong', 'rgba(255,255,255,.13)'), font: g('--font-sans', 'system-ui, sans-serif') };
}
function useColors(): Colors {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setV((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(readColors, [v]);
}

interface DrawArgs { W: number; dpr: number; c: Colors; buckets: Bucket[]; unit: Unit; max: number; view: Range; ticks: ReturnType<typeof buildTicks>; sel: Range | null; hoverStart: number | null }

function draw(cv: HTMLCanvasElement, a: DrawArgs) {
  const { W, dpr, c, buckets, unit, max, view, ticks, sel, hoverStart } = a;
  const pw = Math.round(W * dpr), ph = Math.round(PLOT_H * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, PLOT_H);
  const k = W / (view[1] - view[0]);
  const X = (t: number) => (t - view[0]) * k;

  // faint year / month guide lines behind the bars
  ctx.fillStyle = c.border;
  for (const tk of ticks) { if (!tk.major) continue; const x = Math.round(X(tk.t)); if (x >= 0 && x <= W) ctx.fillRect(x, 0, 1, BH); }
  ctx.fillRect(0, BH, W, 1);

  // bars
  const barW = (b: Bucket) => X(b.end) - X(b.start);
  const gap = (w: number) => (w >= 14 ? 2 : w >= 5 ? 1 : 0);
  const hOf = (n: number) => Math.max(2, Math.sqrt(n / (max || 1)) * (BH - 5));
  const bar = (b: Bucket) => {
    const w0 = barW(b), g = gap(w0);
    const x = X(b.start) + g / 2, w = Math.max(1.2, w0 - g), h = hOf(b.count);
    if (x + w < 0 || x > W) return;
    if (w >= 6) { ctx.beginPath(); ctx.roundRect(x, BH - h, w, h, [2, 2, 0, 0]); ctx.fill(); } else ctx.fillRect(x, BH - h, w, h);
  };
  const bars = () => { for (const b of buckets) if (b.count > 0) bar(b); };
  ctx.fillStyle = c.accent;
  if (sel) {
    ctx.globalAlpha = 0.3; bars();
    const x0 = Math.floor(X(sel[0])), x1 = Math.max(x0 + 1, Math.ceil(X(sel[1])));
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, BH + 1); ctx.clip(); ctx.globalAlpha = 1; bars(); ctx.restore();
  } else { ctx.globalAlpha = 0.9; bars(); }
  if (hoverStart != null) {
    const b = buckets.find((q) => q.start === hoverStart);
    if (b && b.count > 0) { ctx.globalAlpha = 1; ctx.fillStyle = c.accentHover; bar(b); }
  }
  ctx.globalAlpha = 1;

  // axis
  ctx.font = `550 10.5px ${c.font}`;
  ctx.textBaseline = 'alphabetic';
  let lastRight = -1e9;
  for (const tk of ticks) {
    const x = X(tk.t);
    if (x < -40 || x > W) continue;
    const px = Math.round(x);
    if (x >= 0) { ctx.fillStyle = c.borderStrong; ctx.fillRect(px, BH + 1, 1, 4); }
    const tx = Math.max(2, px + 4);
    const tw = ctx.measureText(tk.label).width;
    if (tx < lastRight + 10 || tx + tw > W + 2) continue;
    ctx.fillStyle = tk.major ? c.text2 : c.text3;
    ctx.font = `${tk.major ? 650 : 550} 10.5px ${c.font}`;
    ctx.fillText(tk.label, tx, BH + 15);
    lastRight = tx + tw;
  }
}

/* ------------------------------------------------------------------------- */

type Drag =
  | { kind: 'new' | 'move' | 'l' | 'r'; x0: number; t0: number; r0: Range | null; moved: boolean }
  | { kind: 'pan'; x0: number; v0: Range; k: number };

type Hover = { kind: 'bar'; b: Bucket; x: number } | { kind: 'trip'; trip: Trip; x: number } | null;

const stepUnit = (t: number, u: Unit, dir: 1 | -1) => (dir > 0 ? nextUnit(floorUnit(t, u), u) : floorUnit(floorUnit(t, u) - 1, u));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props { ix: TimeIndex | null; trips: Trip[]; bounds: Range | null; onZoomedChange?: (zoomed: boolean) => void; fitSignal: number }

export default function TimelineChart({ ix, trips, bounds, onZoomedChange, fitSignal }: Props) {
  const t = useT();
  useLang((s) => s.lang);
  const locale = currentLocale();
  const colors = useColors();
  const range = useUi((s) => s.filters.range);

  const hintId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(0);
  const [view, setViewState] = useState<Range>(() => (ix ? fitView(ix) : [Date.now() - 365 * DAY, Date.now()]));
  const viewRef = useRef(view);
  const userZoomed = useRef(false);
  const [draft, setDraft] = useState<Range | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [focused, setFocused] = useState(false);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const anim = useRef(0);
  const lastCommit = useRef(0);

  const lim = useMemo(() => (ix ? viewLimits(ix) : null), [ix]);
  const fit = useMemo(() => (ix ? fitView(ix) : null), [ix]);
  const sel = draft ?? range;

  const setView = useCallback((v: Range, user = true) => {
    viewRef.current = v; setViewState(v);
    if (user) userZoomed.current = true;
  }, []);
  const animateView = useCallback((to: Range) => {
    cancelAnimationFrame(anim.current);
    userZoomed.current = true;
    const from = viewRef.current;
    if (reduceMotion()) { setView(to); return; }
    const t0 = performance.now(), D = 280;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / D), e = 1 - (1 - p) ** 3;
      setView([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [setView]);

  // resize
  useLayoutEffect(() => {
    const el = plotRef.current!;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el); setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // data changed -> refit unless the user is exploring
  useEffect(() => {
    if (!ix || !fit || !lim) return;
    if (!userZoomed.current) setView(fit, false);
    else setView(clampView(viewRef.current, lim), false);
  }, [ix, fit, lim, setView]);
  // "fit" button
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) { firstFit.current = false; return; }
    if (fit) { userZoomed.current = false; animateView(fit); userZoomed.current = false; }
  }, [fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomed = !!fit && (Math.abs(view[0] - fit[0]) + Math.abs(view[1] - fit[1])) / (fit[1] - fit[0]) > 0.015;
  useEffect(() => { onZoomedChange?.(zoomed); }, [zoomed, onZoomedChange]);

  const spanMs = view[1] - view[0];
  const ppd = W > 0 ? W / (spanMs / DAY) : 1;
  const unit = pickUnit(ppd);
  const k = W > 0 ? W / spanMs : 0;
  const X = (tm: number) => (tm - view[0]) * k;
  const buckets = useMemo(() => (ix && W > 0 ? buildBuckets(ix, unit, view[0], view[1]) : []), [ix, unit, view, W]);
  const ticks = useMemo(() => buildTicks(view[0], view[1], W, locale), [view, W, locale]);
  const max = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.count), 0), [buckets]);
  const hoverStart = hover?.kind === 'bar' ? hover.b.start : null;

  useLayoutEffect(() => {
    if (!canvasRef.current || W <= 0) return;
    draw(canvasRef.current, { W, dpr: window.devicePixelRatio || 1, c: colors, buckets, unit, max, view, ticks, sel, hoverStart });
  }, [W, colors, buckets, unit, max, view, ticks, sel, hoverStart]);

  // latest values for event handlers
  const st = useRef({ view, unit, sel, W, ix, buckets, lim, k });
  st.current = { view, unit, sel, W, ix, buckets, lim, k };

  const commit = useCallback((r: Range | null, force = false) => {
    const now = performance.now();
    if (force || now - lastCommit.current > 90) { lastCommit.current = now; useUi.getState().setFilters({ range: r }); }
  }, []);

  // reveal an externally changed range (presets, trips, filter chips) when it is not fully visible
  useEffect(() => {
    if (!range || drag.current || !lim) return;
    const v = viewRef.current;
    if (range[0] >= v[0] && range[1] <= v[1]) return;
    const span = range[1] - range[0], margin = Math.max(span * 0.25, 3 * DAY);
    let nv: Range;
    if (span + 2 * margin >= v[1] - v[0]) nv = [range[0] - margin, range[1] + margin];
    else if (range[0] < v[0] + margin) nv = [range[0] - margin, range[0] - margin + (v[1] - v[0])];
    else nv = [range[1] + margin - (v[1] - v[0]), range[1] + margin];
    animateView(clampView(nv, lim));
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the playhead in view while playing
  useEffect(() => usePlayback.subscribe((s, p) => {
    if (!s.playing || s.cursor == null || s.cursor === p.cursor) return;
    const v = viewRef.current, l = st.current.lim;
    const sp = v[1] - v[0];
    if (s.cursor < v[0] + sp * 0.02 || s.cursor > v[1] - sp * 0.04) {
      if (!l) return;
      setView(clampView([s.cursor - sp * 0.15, s.cursor + sp * 0.85], l), false);
    }
  }), [setView]);

  // wheel = zoom (horizontal wheel = pan)
  useEffect(() => {
    const el = plotRef.current!;
    const onWheel = (e: WheelEvent) => {
      const s = st.current;
      if (!s.lim || s.W <= 0) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const v = viewRef.current, span = v[1] - v[0];
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        const shift = (e.deltaX / s.W) * span;
        setView(clampView([v[0] + shift, v[1] + shift], s.lim));
        return;
      }
      const x = e.clientX - el.getBoundingClientRect().left;
      const at = v[0] + (x / s.W) * span;
      const f = Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * (e.ctrlKey ? 0.01 : 0.0016));
      const ns = Math.min(Math.max(span * f, MIN_SPAN), s.lim[1] - s.lim[0]);
      const from = at - (at - v[0]) * (ns / span);
      setView(clampView([from, from + ns], s.lim));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  // space = pan modifier
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && plotRef.current?.matches(':hover, :focus-within') && !(e.target instanceof HTMLInputElement)) { space.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    addEventListener('keydown', dn); addEventListener('keyup', up); addEventListener('blur', up as () => void);
    return () => { removeEventListener('keydown', dn); removeEventListener('keyup', up); removeEventListener('blur', up as () => void); };
  }, []);

  /* ------------------------------------------------------------ pointer */

  const xOf = (e: { clientX: number }) => e.clientX - plotRef.current!.getBoundingClientRect().left;
  const tOf = (x: number) => st.current.view[0] + x / st.current.k;
  const bucketAt = (tm: number): Bucket | null => {
    const bs = st.current.buckets;
    let lo = 0, hi = bs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (tm < bs[m].start) hi = m - 1; else if (tm >= bs[m].end) lo = m + 1; else return bs[m]; }
    return null;
  };
  const hit = (x: number): 'l' | 'r' | 'move' | 'new' => {
    const s = st.current.sel;
    if (!s) return 'new';
    const xa = (s[0] - st.current.view[0]) * st.current.k, xb = (s[1] - st.current.view[0]) * st.current.k;
    const da = Math.abs(x - xa), db = Math.abs(x - xb);
    if (da <= EDGE && da <= db) return 'l';
    if (db <= EDGE) return 'r';
    return x > xa && x < xb ? 'move' : 'new';
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const s = st.current;
    if (!s.lim) return;
    cancelAnimationFrame(anim.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    plotRef.current!.focus({ preventScroll: true });
    const x = xOf(e);
    if (e.button === 1 || space.current) { drag.current = { kind: 'pan', x0: x, v0: s.view, k: s.k }; e.preventDefault(); return; }
    drag.current = { kind: hit(x), x0: x, t0: tOf(x), r0: s.sel, moved: false };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const s = st.current;
    const x = xOf(e);
    const d = drag.current;
    if (!d) {
      const tm = tOf(x), b = bucketAt(tm);
      setHover((h) => (b && b.count > 0 ? (h?.kind === 'bar' && h.b.start === b.start && Math.abs(h.x - x) < 1 ? h : { kind: 'bar', b, x }) : h ? null : h));
      const el = plotRef.current!;
      el.style.cursor = space.current ? 'grab' : { l: 'ew-resize', r: 'ew-resize', move: 'grab', new: 'crosshair' }[hit(x)];
      return;
    }
    if (d.kind === 'pan') {
      const dx = x - d.x0;
      plotRef.current!.style.cursor = 'grabbing';
      if (s.lim) setView(clampView([d.v0[0] - dx / d.k, d.v0[1] - dx / d.k], s.lim));
      return;
    }
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    d.moved = true;
    setHover(null);
    const tm = tOf(x), u = s.unit;
    let r: Range;
    if (d.kind === 'new') {
      const a = floorUnit(d.t0, u), b = floorUnit(tm, u);
      r = [Math.min(a, b), endOfUnit(Math.max(a, b), u)];
    } else if (d.kind === 'move' && d.r0) {
      const delta = Math.round((tm - d.t0) / DAY) * DAY;
      r = [d.r0[0] + delta, d.r0[1] + delta];
      plotRef.current!.style.cursor = 'grabbing';
    } else if (d.kind === 'l' && d.r0) r = [Math.min(floorUnit(tm, u), d.r0[1]), d.r0[1]];
    else if (d.kind === 'r' && d.r0) r = [d.r0[0], Math.max(endOfUnit(tm, u), d.r0[0])];
    else return;
    setDraft(r);
    commit(r);
    // edge auto-pan while dragging past the plot
    if (s.lim && (x < 0 || x > s.W)) {
      const v = viewRef.current, shift = ((x < 0 ? x : x - s.W) / s.W) * (v[1] - v[0]) * 0.08;
      setView(clampView([v[0] + shift, v[1] + shift], s.lim));
    }
  };

  const endDrag = (e: RPointerEvent, cancelled = false) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    plotRef.current!.style.cursor = '';
    if (d.kind === 'pan') return;
    if (!d.moved) { if (!cancelled && e.type === 'pointerup' && d.kind === 'new' && st.current.sel) commit(null, true); return; }
    setDraft((r) => { if (r && !cancelled) commit(r, true); return null; });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const x = xOf(e), b = bucketAt(tOf(x));
    if (!b || b.count === 0 || !st.current.lim) return;
    commit([b.start, b.end - 1], true);
    const len = b.end - b.start, span = Math.max(len * 3, 14 * DAY), c = (b.start + b.end) / 2;
    animateView(clampView([c - span / 2, c + span / 2], st.current.lim));
  };

  /* ----------------------------------------------------------- keyboard */

  const onKeyDown = (e: RKeyboardEvent) => {
    const s = st.current;
    if (!s.ix || !s.lim) return;
    const u = s.unit, r = s.sel;
    if (e.key === 'Escape') { if (r) { e.preventDefault(); e.stopPropagation(); commit(null, true); } return; }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault();
      const v = viewRef.current, c = r ? (r[0] + r[1]) / 2 : (v[0] + v[1]) / 2, f = e.key === '+' || e.key === '=' ? 0.6 : 1 / 0.6;
      const ns = Math.min(Math.max((v[1] - v[0]) * f, MIN_SPAN), s.lim[1] - s.lim[0]);
      animateView(clampView([c - ns / 2, c + ns / 2], s.lim));
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
    const [l0, l1] = s.lim;
    if (!r) {
      const at = Math.min(s.ix.last, s.view[1]);
      commit([floorUnit(at, u), endOfUnit(at, u)], true);
      return;
    }
    let next: Range = r;
    if (e.shiftKey && (e.ctrlKey || e.metaKey)) next = [Math.min(stepUnit(r[0], u, dir), r[1]), r[1]];
    else if (e.shiftKey) next = [r[0], Math.max(endOfUnit(stepUnit(r[1], u, dir), u), r[0])];
    else next = [stepUnit(r[0], u, dir), endOfUnit(stepUnit(r[1], u, dir), u)];
    if (next[0] < l0 - 400 * DAY || next[1] > l1 + 400 * DAY) return;
    commit(next, true);
  };

  /* ------------------------------------------------------------ overlays */

  const selBox = useMemo(() => {
    if (!sel || W <= 0) return null;
    const x0 = X(sel[0]), x1 = X(sel[1]);
    if (x1 < 0 || x0 > W) return null;
    return { x0, x1: Math.max(x1, x0 + 2) };
  }, [sel, view, W]); // eslint-disable-line react-hooks/exhaustive-deps

  const laneTrips = useMemo(() => {
    if (W <= 0) return [];
    const out: Array<{ trip: Trip; l: number; w: number }> = [];
    for (const trip of trips) {
      const a = floorUnit(trip.from, 'day'), b = floorUnit(trip.to, 'day') + DAY;
      if (b < view[0] || a > view[1]) continue;
      const l = (a - view[0]) * k;
      out.push({ trip, l, w: Math.max(3, (b - a) * k - 1) });
    }
    return out;
  }, [trips, view, W, k]);

  const tripRange = (tr: Trip): Range => [floorUnit(tr.from, 'day'), floorUnit(tr.to, 'day') + DAY - 1];
  const openTrip = (tr: Trip) => {
    const r = tripRange(tr);
    const ui = useUi.getState();
    if (sameRange(ui.filters.range, r)) { ui.setFilters({ range: null }); return; }
    ui.setFilters({ range: r });
    ui.requestFlyTo({ bbox: tr.bbox });
  };
  const zoomTrip = (tr: Trip) => {
    if (!st.current.lim) return;
    const [a, b] = tripRange(tr), span = Math.max((b - a) * 1.6, 10 * DAY), c = (a + b) / 2;
    animateView(clampView([c - span / 2, c + span / 2], st.current.lim));
  };

  const tipText = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === 'bar') return { main: formatBucket(hover.b, unit, locale), sub: tn('timeline.photos', hover.b.count) };
    const tr = hover.trip;
    return { main: tr.title, sub: `${formatRange(tr.from, tr.to, locale)} · ${tn('timeline.trip.photos', tr.photoIds.length)}` };
  }, [hover, unit, locale]);

  const barTop = hover?.kind === 'bar' ? BH - Math.max(2, Math.sqrt(hover.b.count / (max || 1)) * (BH - 5)) : 0;
  const hoverBand = hover?.kind === 'trip' ? tripRange(hover.trip) : null;

  return (
    <>
      <div
        ref={plotRef}
        className="tl-plot"
        tabIndex={0}
        role="group"
        aria-label={t('timeline.title')}
        aria-describedby={hintId}
        data-focus={focused || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={(e) => endDrag(e, true)}
        onPointerLeave={() => { if (!drag.current) setHover((h) => (h?.kind === 'bar' ? null : h)); }}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onAuxClick={(e) => e.preventDefault()}
        style={{ height: PLOT_H }}
      >
        <span id={hintId} className="sr-only">{t('timeline.hint')}</span>
        <canvas ref={canvasRef} className="tl-canvas" style={{ width: W, height: PLOT_H }} />
        {!ix && <div className="tl-empty">{t('timeline.empty')}</div>}
        {hoverBand && <div className="tl-band" style={{ left: X(hoverBand[0]), width: Math.max(2, X(hoverBand[1]) - X(hoverBand[0])), height: BH }} />}
        {selBox && (
          <div className="tl-selwrap" style={{ height: BH + 1 }}>
            <div className="tl-sel" data-drag={draft ? '' : undefined} style={{ transform: `translateX(${selBox.x0}px)`, width: selBox.x1 - selBox.x0 }}>
              <i className="tl-grip tl-grip--l" /><i className="tl-grip tl-grip--r" />
            </div>
          </div>
        )}
        <Playhead view={view} W={W} bounds={bounds} />
        {hover && tipText && (
          <div className="tl-tip" role="tooltip" style={{ left: Math.max(8, Math.min(W - 8, hover.kind === 'bar' ? X((hover.b.start + hover.b.end) / 2) : hover.x)), top: hover.kind === 'bar' ? Math.max(-26, barTop - 38) : BH - 10 }}>
            <b>{tipText.main}</b><i />{tipText.sub}
          </div>
        )}
      </div>

      <div className="tl-lane" aria-label={t('timeline.trips')}>
        {laneTrips.map(({ trip, l, w }) => {
          const active = sameRange(range, tripRange(trip));
          const label = w >= 110 ? `${trip.title} · ${new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(trip.from)}` : w >= 44 ? trip.title : '';
          return (
            <button
              key={trip.id}
              className="tl-trip"
              data-away={trip.away || undefined}
              aria-pressed={active}
              aria-label={`${trip.title}, ${formatRange(trip.from, trip.to, locale)}`}
              style={{ left: l, width: w }}
              onClick={() => openTrip(trip)}
              onDoubleClick={(e) => { e.stopPropagation(); zoomTrip(trip); }}
              onPointerEnter={() => setHover({ kind: 'trip', trip, x: l + w / 2 })}
              onPointerLeave={() => setHover((h) => (h?.kind === 'trip' ? null : h))}
              onFocus={() => setHover({ kind: 'trip', trip, x: l + w / 2 })}
              onBlur={() => setHover((h) => (h?.kind === 'trip' ? null : h))}
            >{label && <span>{label}</span>}</button>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- playhead */

function Playhead({ view, W, bounds }: { view: Range; W: number; bounds: Range | null }) {
  const t = useT();
  const cursor = usePlayback((s) => s.cursor);
  if (cursor == null || W <= 0 || !bounds) return null;
  const k = W / (view[1] - view[0]);
  const x = (cursor - view[0]) * k;
  const end = Math.max(bounds[1], bounds[0] + DAY);

  const scrub = (e: RPointerEvent) => {
    const plot = (e.currentTarget as HTMLElement).closest('.tl-plot') as HTMLElement;
    const left = plot.getBoundingClientRect().left;
    const tm = view[0] + (e.clientX - left) / k;
    usePlayback.getState().setCursor(Math.min(end, Math.max(bounds[0], tm)));
  };
  return (
    <>
      <div className="tl-future" style={{ transform: `translateX(${Math.min(Math.max(x, 0), W)}px)` }} />
      {x >= -6 && x <= W + 6 && (
        <div className="tl-playhead" style={{ transform: `translateX(${x}px)` }}>
          <button
            className="tl-playhead__grip"
            aria-label={t('timeline.scrub')}
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); usePlayback.getState().setPlaying(false); scrub(e); }}
            onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault(); e.stopPropagation();
              const step = (e.shiftKey ? 30 : 1) * DAY * (e.key === 'ArrowRight' ? 1 : -1);
              usePlayback.getState().setPlaying(false);
              usePlayback.getState().setCursor(Math.min(end, Math.max(bounds[0], cursor + step)));
            }}
          />
        </div>
      )}
    </>
  );
}
