import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Check, Heart, MapPinOff, Play } from 'lucide-react';
import type { Photo } from '@shared/types';
import clsx from 'clsx';
import { tn, useT, useLang } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { thumbUrl } from '@/lib/media';
import { fmtDate, fmtDuration } from '@/lib/format';
import { computeLayout, firstRowAtOrBelow, rowOfIndex, HEADING_H, type HeadingRow, type PhotoRow, type Row } from './layout';
import { GAP, ROW_HEIGHT, usePhotoPrefs, type Density, type GroupBy } from './prefs';
import Scrubber, { GRID_BOTTOM_PAD } from './Scrubber';
import { toggleFavorite, usePhotoContextMenu } from './photoActions';
import './photos.css';

// CONTRACT (other features rely on this signature) – optional props may be added.
export interface PhotoGridProps {
  photos: Photo[];
  /** rendered when photos is empty */
  emptyState?: ReactNode;
  /** rendered at the top inside the scroll container (e.g. album hero) */
  header?: ReactNode;
  /** group rows under day/month headings (default true; false for albums with custom order) */
  grouped?: boolean;
  /** custom open handler; default opens the viewer with the ids of `photos` */
  onOpen?(index: number): void;
  /** show a skeleton instead of the photos */
  loading?: boolean;
  /** remembers the scroll position across unmounts under this key */
  scrollKey?: string;
  /** override the shared preference (S/M/L) */
  density?: Density;
  /** override the shared preference (day/month headings) */
  groupBy?: GroupBy;
}

const PAD_L = 16;
const PAD_R_SCRUB = 40;
const PAD_R = 16;
const scrollMemory = new Map<string, number>();

const thumbSizeFor = (rowH: number): 256 | 512 => (rowH > 200 ? 512 : 256);

/* ---------------------------------------------------------------- cell */

interface CellLabels { select: string; deselect: string; fav: string; unfav: string; video: string; noLoc: string }

const Cell = memo(function Cell({ photo, index, x, w, h, selected, focused, size, labels }: {
  photo: Photo; index: number; x: number; w: number; h: number; selected: boolean; focused: boolean; size: 256 | 512; labels: CellLabels;
}) {
  const geo = photo.lat != null;
  return (
    <div
      id={`pc-${photo.id}`} role="option" aria-selected={selected} aria-label={`${photo.name}, ${fmtDate(photo.sortTime)}${photo.favorite ? ', ♥' : ''}`}
      className="pc" data-i={index} data-sel={selected || undefined} data-focus={focused || undefined} data-fav={photo.favorite || undefined}
      data-video={photo.kind === 'video' || undefined} data-nogps={!geo || undefined}
      style={{ left: x, width: w, height: h }}
    >
      <div className="pc__frame" style={{ background: photo.color }}>
        <img
          src={thumbUrl(photo, size)} alt="" draggable={false} loading="lazy" decoding="async"
          ref={(img) => { if (img?.complete && img.naturalWidth) img.classList.add('is-loaded'); }}
          onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
        />
      </div>
      <span className="pc__shade" />
      <span className="pc__check" data-act="check" title={selected ? labels.deselect : labels.select}><Check size={13} strokeWidth={3} /></span>
      {photo.kind === 'video' && (
        <span className="pc__video" title={labels.video}><Play size={9} fill="currentColor" strokeWidth={0} />{photo.duration != null ? <span className="tabular">{fmtDuration(photo.duration)}</span> : null}</span>
      )}
      {!geo && <span className="pc__nogps" title={labels.noLoc}><MapPinOff size={13} /></span>}
      <span className="pc__fav" data-act="fav" title={photo.favorite ? labels.unfav : labels.fav}><Heart size={15} fill={photo.favorite ? 'currentColor' : 'none'} strokeWidth={2} /></span>
    </div>
  );
});

/* ------------------------------------------------------------- heading */

const Heading = memo(function Heading({ row, sticky, allSelected, labels, lang, groupBy }: { row: HeadingRow; sticky: boolean; allSelected: boolean; labels: { select: string; deselect: string }; lang: string; groupBy: GroupBy }) {
  void lang;
  const title = groupBy === 'month'
    ? fmtDate(row.time, { month: 'long', year: 'numeric' })
    : fmtDate(row.time, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className={clsx('ph', sticky && 'ph--sticky', row.first && 'ph--first')} style={{ height: row.h }} role="presentation">
      <div className="ph__text">
        <span className="ph__title">{title}</span>
        {row.places.length > 0 && <span className="ph__place truncate">{row.places.join(', ')}{row.morePlaces > 0 ? ` +${row.morePlaces}` : ''}</span>}
      </div>
      <span className="ph__count tabular">{tn('common.photos', row.count)}</span>
      <span className="ph__check" data-act="group" data-from={row.from} data-to={row.to} data-on={allSelected || undefined}
        title={allSelected ? labels.deselect : labels.select}><Check size={13} strokeWidth={3} /></span>
    </div>
  );
});

/* ------------------------------------------------------------- skeleton */

function Skeleton({ rowHeight, grouped }: { rowHeight: number; grouped: boolean }) {
  const rows = useMemo(() => Array.from({ length: 12 }, (_, r) => Array.from({ length: 5 + ((r * 3) % 4) }, (_, i) => 0.7 + (((r * 7 + i * 13) % 10) / 10) * 1.1)), []);
  return (
    <div className="pg-skel" aria-hidden="true" style={{ paddingLeft: PAD_L, paddingRight: PAD_R }}>
      {rows.map((ars, r) => (
        <div key={r}>
          {grouped && r % 4 === 0 && <div className="pg-skel__head skeleton" />}
          <div className="pg-skel__row" style={{ height: rowHeight }}>
            {ars.map((ar, i) => <div key={i} className="skeleton" style={{ flex: `${ar} 1 0`, borderRadius: 3, animationDelay: `${(r + i) * 60}ms` }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- grid */

export function PhotoGrid({ photos, emptyState, header, grouped = true, onOpen, loading, scrollKey, density: densityProp, groupBy: groupByProp }: PhotoGridProps) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const prefs = usePhotoPrefs();
  const density = densityProp ?? prefs.density;
  const groupBy = groupByProp ?? prefs.groupBy;
  const rowHeight = ROW_HEIGHT[density];
  const gap = GAP[density];
  const selection = useUi((s) => s.selection);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [headerH, setHeaderH] = useState(0);
  const [cursor, setCursor] = useState(-1);
  const [hasFocus, setHasFocus] = useState(false);
  const anchor = useRef(-1);
  const suppressClick = useRef(false);

  // container size
  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) { setHeaderH(0); return; }
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [header]);

  const padR = grouped ? PAD_R_SCRUB : PAD_R;
  const contentW = useDeferredValue(Math.max(0, box.w - PAD_L - padR));
  const layout = useMemo(
    () => computeLayout(photos, { width: contentW, rowHeight, gap, grouped, groupBy }),
    [photos, contentW, rowHeight, gap, grouped, groupBy],
  );
  const size = thumbSizeFor(rowHeight);

  // ---- virtualisation (rows), with the active day heading kept mounted + sticky
  const activeSticky = useRef(-1);
  const rangeExtractor = useCallback((range: Range) => {
    const heads = layout.headIdx;
    let lo = 0, hi = heads.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (heads[mid] <= range.startIndex) { found = heads[mid]; lo = mid + 1; } else hi = mid - 1; }
    activeSticky.current = found;
    const base = defaultRangeExtractor(range);
    if (found < 0 || base.includes(found)) return base;
    return [found, ...base];
  }, [layout.headIdx]);
  const virt = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (i) => layout.rows[i]?.h ?? rowHeight,
    overscan: 4,
    scrollMargin: headerH,
    rangeExtractor,
  });
  useLayoutEffect(() => { virt.measure(); }, [layout, headerH, virt]);

  // ---- scroll memory
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    if (!restored.current && scrollKey && layout.rows.length && box.w) {
      restored.current = true;
      const y = scrollMemory.get(scrollKey);
      if (y) el.scrollTop = y;
    }
  }, [layout, box.w, scrollKey]);
  useEffect(() => {
    const el = scrollerRef.current!;
    if (!scrollKey) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => scrollMemory.set(scrollKey, el.scrollTop)); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [scrollKey]);

  // ---- opening / menu
  const openAt = useCallback((i: number) => {
    if (onOpen) onOpen(i);
    else useUi.getState().openViewer(photos.map((p) => p.id), i);
  }, [onOpen, photos]);
  const ctx = usePhotoContextMenu(useCallback((id: string) => { const i = photos.findIndex((p) => p.id === id); if (i >= 0) openAt(i); }, [photos, openAt]));

  // ---- helpers
  const idsBetween = (a: number, b: number) => { const [lo, hi] = a < b ? [a, b] : [b, a]; const out: string[] = []; for (let i = lo; i <= hi; i++) out.push(photos[i].id); return out; };
  const scroller = () => scrollerRef.current!;
  const ensureVisible = useCallback((index: number) => {
    const el = scrollerRef.current; if (!el || !layout.photoRows.length) return;
    const row = layout.photoRows[rowOfIndex(layout.photoRows, Math.max(0, Math.min(index, photos.length - 1)))];
    const top = headerH + row.top, bottom = top + row.imgH, st = el.scrollTop, ch = el.clientHeight;
    const topInset = grouped ? HEADING_H + 4 : 8;
    if (top - topInset < st) el.scrollTop = Math.max(0, top - topInset);
    else if (bottom + 8 > st + ch) el.scrollTop = bottom + 8 - ch;
  }, [layout, headerH, photos.length, grouped]);

  const moveCursor = useCallback((next: number, extend: boolean) => {
    if (!photos.length) return;
    const i = Math.max(0, Math.min(photos.length - 1, next));
    setCursor(i); ensureVisible(i);
    const ui = useUi.getState();
    if (extend) { if (anchor.current < 0) anchor.current = cursor >= 0 ? cursor : i; ui.select(idsBetween(anchor.current, i), 'replace'); }
    else anchor.current = i;
  }, [photos, cursor, ensureVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const verticalNeighbor = (index: number, dir: -1 | 1, rows = 1): number => {
    const pr = layout.photoRows;
    const r = rowOfIndex(pr, index);
    const cur = pr[r];
    const item = cur.items.find((it) => it.index === index) ?? cur.items[0];
    const cx = item.x + item.w / 2;
    const tr = Math.max(0, Math.min(pr.length - 1, r + dir * rows));
    if (tr === r) return dir < 0 ? pr[0].first : pr[pr.length - 1].items.at(-1)!.index;
    let best = pr[tr].items[0], bd = Infinity;
    for (const it of pr[tr].items) { const d = Math.abs(it.x + it.w / 2 - cx); if (d < bd) { bd = d; best = it; } }
    return best.index;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!photos.length) return;
    const ui = useUi.getState();
    const cur = cursor >= 0 ? cursor : 0;
    const extend = e.shiftKey;
    const pageRows = Math.max(1, Math.floor(box.h / (rowHeight + gap)) - 1);
    switch (e.key) {
      case 'ArrowRight': moveCursor(cursor < 0 ? 0 : cur + 1, extend); break;
      case 'ArrowLeft': moveCursor(cursor < 0 ? 0 : cur - 1, extend); break;
      case 'ArrowDown': moveCursor(cursor < 0 ? 0 : verticalNeighbor(cur, 1), extend); break;
      case 'ArrowUp': moveCursor(cursor < 0 ? 0 : verticalNeighbor(cur, -1), extend); break;
      case 'PageDown': moveCursor(verticalNeighbor(cur, 1, pageRows), extend); break;
      case 'PageUp': moveCursor(verticalNeighbor(cur, -1, pageRows), extend); break;
      case 'Home': moveCursor(0, extend); break;
      case 'End': moveCursor(photos.length - 1, extend); break;
      case 'Enter': if (cursor >= 0) openAt(cursor); break;
      case ' ': if (cursor >= 0) { ui.select([photos[cursor].id], 'toggle'); anchor.current = cursor; } break;
      case 'f': case 'F':
        if (!e.ctrlKey && !e.metaKey) { const ids = ui.selection.size ? [...ui.selection] : cursor >= 0 ? [photos[cursor].id] : []; if (ids.length) toggleFavorite(ids); } else return;
        break;
      case 'a': case 'A':
        if (e.ctrlKey || e.metaKey) ui.select(photos.map((p) => p.id), 'replace'); else return;
        break;
      case 'ContextMenu': case 'F10': {
        if (e.key === 'F10' && !e.shiftKey) return;
        const id = cursor >= 0 ? photos[cursor].id : null; if (!id) return;
        const el = document.getElementById(`pc-${id}`)?.getBoundingClientRect();
        const ids = ui.selection.has(id) ? [...ui.selection] : [id];
        ctx.show(el ? el.left + el.width / 2 : 200, el ? el.top + el.height / 2 : 200, ids);
        break;
      }
      default: return;
    }
    e.preventDefault();
  };

  // Ctrl+A while the grid is mounted and nothing editable has focus
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || e.defaultPrevented) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      if (useUi.getState().viewer || useUi.getState().commandPaletteOpen || document.querySelector('.dialog-backdrop')) return;
      e.preventDefault(); useUi.getState().select(photos.map((p) => p.id), 'replace');
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, [photos]);

  // ---- delegated mouse handling
  const cellOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.('[data-i]') as HTMLElement | null;

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const target = e.target as HTMLElement;
    const actEl = target.closest('[data-act]') as HTMLElement | null;
    const ui = useUi.getState();
    if (actEl?.dataset.act === 'group') {
      const from = +actEl.dataset.from!, to = +actEl.dataset.to!;
      const ids = idsBetween(from, to);
      if (ids.every((id) => ui.selection.has(id))) { const next = new Set(ui.selection); ids.forEach((id) => next.delete(id)); ui.select(next, 'replace'); } else ui.select(ids, 'add');
      return;
    }
    const cell = cellOf(target);
    if (!cell) { if (!target.closest('.pg__header') && !e.ctrlKey && !e.metaKey && !e.shiftKey && ui.selection.size) ui.clearSelection(); return; }
    const i = +cell.dataset.i!;
    const photo = photos[i]; if (!photo) return;
    setCursor(i);
    if (actEl?.dataset.act === 'fav') { toggleFavorite([photo.id]); return; }
    if (actEl?.dataset.act === 'check' || e.ctrlKey || e.metaKey) { ui.select([photo.id], 'toggle'); anchor.current = i; return; }
    if (e.shiftKey) { ui.select(idsBetween(anchor.current >= 0 ? anchor.current : i, i), 'replace'); return; }
    if (ui.selection.size > 0) { ui.select([photo.id], 'toggle'); anchor.current = i; return; }
    anchor.current = i;
    openAt(i);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const cell = cellOf(e.target); if (!cell || (e.target as HTMLElement).closest('[data-act]')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    openAt(+cell.dataset.i!);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    const cell = cellOf(e.target); if (!cell) return;
    e.preventDefault();
    const i = +cell.dataset.i!; const id = photos[i]?.id; if (!id) return;
    const ui = useUi.getState();
    let ids: string[];
    if (ui.selection.has(id)) ids = [...ui.selection]; else { ui.select([id], 'replace'); ids = [id]; anchor.current = i; }
    setCursor(i);
    ctx.show(e.clientX, e.clientY, ids);
  };
  const onPointerOver = (e: React.PointerEvent) => {
    const cell = cellOf(e.target); const id = cell ? photos[+cell.dataset.i!]?.id ?? null : null;
    if (useUi.getState().hoverId !== id) useUi.getState().setHoverId(id);
  };
  const onPointerLeave = () => { if (useUi.getState().hoverId) useUi.getState().setHoverId(null); };

  // hover from elsewhere (map) → highlight cell imperatively (no re-render of the grid)
  useEffect(() => {
    let prev: HTMLElement | null = null;
    return useUi.subscribe((s, p) => {
      if (s.hoverId === p.hoverId) return;
      prev?.removeAttribute('data-xhover'); prev = null;
      if (s.hoverId) { const el = document.getElementById(`pc-${s.hoverId}`); if (el) { el.setAttribute('data-xhover', ''); prev = el; } }
    });
  }, []);

  // ---- marquee selection
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !layout.photoRows.length) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-act], .pg__header, .ph__check')) return;
    const el = scroller();
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left > el.clientWidth) return; // native scrollbar
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(useUi.getState().selection) : new Set<string>();
    const start = { x: e.clientX, y: e.clientY, sx: e.clientX - rect.left, sy: e.clientY - rect.top + el.scrollTop };
    let active = false, last = { x: e.clientX, y: e.clientY }, raf = 0, prevKey = '';
    const mq = marqueeRef.current!;

    const update = () => {
      const r = el.getBoundingClientRect();
      const cx = Math.max(0, Math.min(el.clientWidth, last.x - r.left)), cy = last.y - r.top + el.scrollTop;
      const x1 = Math.min(start.sx, cx), x2 = Math.max(start.sx, cx), y1 = Math.min(start.sy, cy), y2 = Math.max(start.sy, cy);
      mq.style.cssText = `display:block;left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px`;
      const hits = new Set(base);
      const ry1 = y1 - headerH, ry2 = y2 - headerH;
      for (let r2 = firstRowAtOrBelow(layout.rows, ry1); r2 < layout.rows.length; r2++) {
        const row = layout.rows[r2] as Row;
        if (row.top > ry2) break;
        if (row.kind !== 'row' || row.top + row.imgH < ry1) continue;
        for (const it of (row as PhotoRow).items) if (PAD_L + it.x < x2 && PAD_L + it.x + it.w > x1) hits.add(photos[it.index].id);
      }
      const key = `${hits.size}:${[...hits].slice(-3).join()}:${x1 | 0}`;
      if (key !== prevKey || hits.size !== useUi.getState().selection.size) { prevKey = key; useUi.getState().select(hits, 'replace'); }
    };
    const tick = () => {
      if (!active) return;
      const r = el.getBoundingClientRect();
      const edge = 48; let dy = 0;
      if (last.y < r.top + edge) dy = -Math.ceil((r.top + edge - last.y) / 3);
      else if (last.y > r.bottom - edge) dy = Math.ceil((last.y - (r.bottom - edge)) / 3);
      if (dy) { el.scrollTop += Math.max(-40, Math.min(40, dy)); update(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        active = true; suppressClick.current = true; raf = requestAnimationFrame(tick);
        document.body.style.cursor = 'crosshair';
      }
      update();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf); mq.style.display = 'none'; document.body.style.cursor = '';
      if (active) setTimeout(() => { suppressClick.current = false; }, 0);
      active = false;
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };

  const labels = useMemo<CellLabels>(() => ({
    select: t('photos.cell.select'), deselect: t('photos.cell.deselect'), fav: t('photos.cell.favorite'), unfav: t('photos.cell.unfavorite'),
    video: t('photos.cell.video'), noLoc: t('photos.cell.noLocation'),
  }), [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const headLabels = useMemo(() => ({ select: t('photos.group.select'), deselect: t('photos.group.deselect') }), [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = virt.getVirtualItems();
  const selecting = selection.size > 0;
  const empty = photos.length === 0;

  return (
    <div className="pg">
      <div
        ref={scrollerRef} className={clsx('pg__scroll', grouped && 'pg__scroll--scrub', selecting && 'pg--selecting')}
        role="listbox" aria-multiselectable="true" aria-label={t('photos.grid.label')} tabIndex={0}
        aria-activedescendant={hasFocus && cursor >= 0 && photos[cursor] ? `pc-${photos[cursor].id}` : undefined}
        onKeyDown={onKeyDown} onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
        onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerLeave={onPointerLeave}
        onFocus={(e) => { setHasFocus(true); if (cursor < 0 && e.target === e.currentTarget && photos.length) { const first = layout.photoRows[rowOfIndex(layout.photoRows, 0)]; setCursor(first?.first ?? 0); } }}
        onBlur={() => setHasFocus(false)}
      >
        {header && <div ref={headerRef} className="pg__header">{header}</div>}
        {loading ? <Skeleton rowHeight={rowHeight} grouped={grouped} />
          : empty ? <div className="pg__empty">{emptyState}</div>
            : (
              <div className="pg__canvas" style={{ height: layout.total + GRID_BOTTOM_PAD, paddingBottom: GRID_BOTTOM_PAD }}>
                {items.map((vi) => {
                  const row = layout.rows[vi.index];
                  if (!row) return null;
                  if (row.kind === 'head') {
                    const sticky = activeSticky.current === vi.index;
                    const allSelected = selecting && row.count <= 5000 && selectedAll(photos, row, selection);
                    return (
                      <div key={vi.index} className={clsx('pg__rowwrap', sticky && 'is-sticky')} style={sticky ? { height: row.h } : { height: row.h, transform: `translateY(${vi.start - headerH}px)` }}>
                        <Heading row={row} sticky={sticky} allSelected={allSelected} labels={headLabels} lang={lang} groupBy={groupBy} />
                      </div>
                    );
                  }
                  return (
                    <div key={vi.index} className="pg__rowwrap" style={{ height: row.h, transform: `translateY(${vi.start - headerH}px)` }}>
                      <div className="pg__row" style={{ left: PAD_L, width: contentW, height: row.imgH }}>
                        {row.items.map((it) => {
                          const p = photos[it.index];
                          return <Cell key={p.id} photo={p} index={it.index} x={it.x} w={it.w} h={row.imgH} selected={selection.has(p.id)} focused={hasFocus && cursor === it.index} size={size} labels={labels} />;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        <div ref={marqueeRef} className="pg__marquee" />
      </div>
      {grouped && !loading && !empty && <Scrubber scrollerRef={scrollerRef} layout={layout} headerH={headerH} />}
      {ctx.element}
    </div>
  );
}

function selectedAll(photos: Photo[], row: HeadingRow, selection: Set<string>): boolean {
  for (let i = row.from; i <= row.to; i++) if (!selection.has(photos[i].id)) return false;
  return true;
}
