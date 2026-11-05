import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useT } from '@/i18n';
import { fmtDate } from '@/lib/format';
import type { GridLayout, Mark } from './layout';

/** padding below the last row inside the scroller – must match `.pg__canvas` bottom spacing in photos.css */
export const GRID_BOTTOM_PAD = 32;
const TRACK_PAD = 10;

/** last mark whose top <= y */
function markAt(marks: Mark[], y: number): Mark | undefined {
  let lo = 0, hi = marks.length - 1;
  if (!marks.length) return undefined;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marks[mid].top <= y) lo = mid; else hi = mid - 1;
  }
  return marks[lo];
}
const labelOf = (m: Mark | undefined) => (m ? fmtDate(m.time, { month: 'long', year: 'numeric' }) : '');

/**
 * Google-Photos-style date scrubber on the right edge: year labels, hover bubble with month/year, drag to scrub,
 * and a position thumb that follows the scroll offset (updated imperatively, no React renders while scrolling).
 */
export default function Scrubber({ scrollerRef, layout, headerH }: { scrollerRef: RefObject<HTMLDivElement | null>; layout: GridLayout; headerH: number }) {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const [trackH, setTrackH] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const dragging = useRef(false);
  const hovering = useRef(false);
  const contentH = headerH + layout.total + GRID_BOTTOM_PAD;

  useEffect(() => {
    const el = trackRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setTrackH(el.clientHeight));
    ro.observe(el); setTrackH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // year labels positioned proportionally to content height, thinned out so they never overlap
  const years = useMemo(() => {
    if (!trackH) return [] as Array<{ y: number; year: number }>;
    const out: Array<{ y: number; year: number }> = [];
    let lastY = -100, lastYear = NaN;
    for (const m of layout.marks) {
      if (m.year === lastYear) continue;
      lastYear = m.year;
      const y = ((headerH + m.top) / contentH) * trackH;
      if (y - lastY < 20) continue;
      out.push({ y, year: m.year }); lastY = y;
    }
    return out;
  }, [layout.marks, trackH, headerH, contentH]);

  // follow scroll: thumb position + transient date bubble
  useEffect(() => {
    const sc = scrollerRef.current; if (!sc) return;
    let hideTimer = 0;
    const sync = (showBubble: boolean) => {
      const th = thumbRef.current, track = trackRef.current; if (!th || !track) return;
      const H = track.clientHeight, ch = sc.clientHeight, total = sc.scrollHeight;
      setScrollable(total > ch + 8);
      const size = Math.max(28, (ch / total) * H);
      const y = total <= ch ? 0 : (sc.scrollTop / (total - ch)) * (H - size);
      th.style.height = `${size}px`; th.style.transform = `translateY(${y}px)`;
      const b = bubbleRef.current;
      if (showBubble && b && !dragging.current) {
        const m = markAt(layout.marks, Math.max(0, sc.scrollTop - headerH + 60));
        b.textContent = labelOf(m); b.style.transform = `translateY(${y + size / 2}px) translateY(-50%)`;
        b.dataset.show = '1'; clearTimeout(hideTimer); hideTimer = window.setTimeout(() => { if (!hovering.current) b.dataset.show = ''; }, 900);
      }
    };
    const onScroll = () => sync(true);
    sc.addEventListener('scroll', onScroll, { passive: true });
    sync(false);
    const ro = new ResizeObserver(() => sync(false)); ro.observe(sc);
    return () => { sc.removeEventListener('scroll', onScroll); ro.disconnect(); clearTimeout(hideTimer); };
  }, [scrollerRef, layout, headerH, trackH]);

  const posToScroll = (clientY: number) => {
    const sc = scrollerRef.current, track = trackRef.current!;
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return { f, y: f * r.height, top: Math.max(0, f * sc!.scrollHeight - sc!.clientHeight / 2) };
  };
  const showHover = (clientY: number) => {
    const sc = scrollerRef.current; if (!sc) return;
    hovering.current = true;
    const { y, top } = posToScroll(clientY);
    const m = markAt(layout.marks, dragging.current ? Math.max(0, top - headerH + 60) : Math.max(0, (y / (trackRef.current!.clientHeight || 1)) * contentH - headerH));
    const b = bubbleRef.current, hv = hoverRef.current; if (!b || !hv) return;
    b.textContent = labelOf(m); b.style.transform = `translateY(${y}px) translateY(-50%)`; b.dataset.show = '1';
    hv.style.transform = `translateY(${y}px)`; hv.dataset.show = '1';
  };
  const hideHover = () => { hovering.current = false; if (dragging.current) return; if (bubbleRef.current) bubbleRef.current.dataset.show = ''; if (hoverRef.current) hoverRef.current.dataset.show = ''; };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    scrollerRef.current!.scrollTop = posToScroll(e.clientY).top;
    showHover(e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging.current) { scrollerRef.current!.scrollTop = posToScroll(e.clientY).top; }
    showHover(e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    dragging.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!(e.currentTarget as HTMLElement).matches(':hover')) hideHover();
  };

  return (
    <div className="scrub" data-on={scrollable || undefined} aria-hidden="true" title={t('photos.scrubber')}>
      <div ref={trackRef} className="scrub__track" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hideHover}>
        {years.map(({ y, year }) => <span key={year} className="scrub__year tabular" style={{ top: y }}>{year}</span>)}
        <div ref={hoverRef} className="scrub__hover" />
        <div ref={thumbRef} className="scrub__thumb" />
      </div>
      <div ref={bubbleRef} className="scrub__bubble" />
    </div>
  );
}

export { TRACK_PAD };
