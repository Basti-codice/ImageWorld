import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, FolderPlus, ListFilter, SquareCheck, X } from 'lucide-react';
import type { AreaSelection, Photo } from '@shared/types';
import { photoInArea, polygonBBox } from '@/lib/geo';
import { thumbUrl } from '@/lib/media';
import { fmtMonthYear } from '@/lib/format';
import { useUi } from '@/state/ui';
import { useT, tn } from '@/i18n';
import { Button, IconButton } from '@/ui';

// ------------------------------------------------------------------ selection card

function summarize(area: AreaSelection, geo: Photo[]) {
  const [w, s, e, n] = polygonBBox(area.polygon);
  const hits: Photo[] = [];
  for (const p of geo) {
    const lo = p.lon as number, la = p.lat as number;
    if (lo < w || lo > e || la < s || la > n) continue;
    if (photoInArea(p, area)) hits.push(p);
  }
  const cities = new Map<string, number>();
  let from = Infinity, to = -Infinity;
  const countries = new Set<string>();
  for (const p of hits) {
    if (p.place?.city) cities.set(p.place.city, (cities.get(p.place.city) ?? 0) + 1);
    if (p.place?.country) countries.add(p.place.country);
    if (p.sortTime < from) from = p.sortTime; if (p.sortTime > to) to = p.sortTime;
  }
  const top = [...cities.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  // up to 4 thumbnails: favourites first, then evenly spread over the selection
  const picks: Photo[] = [];
  for (const p of hits) { if (p.favorite && picks.length < 4) picks.push(p); }
  for (let k = 0; picks.length < Math.min(4, hits.length) && k < 8; k++) {
    const p = hits[Math.floor((k * Math.max(0, hits.length - 1)) / 3)];
    if (p && !picks.includes(p)) picks.push(p);
  }
  return { hits, top, countries: [...countries], from, to, picks: picks.slice(0, 4) };
}

export function SelectionCard({ area, geo }: { area: AreaSelection; geo: Photo[] }) {
  const t = useT();
  const sum = useMemo(() => summarize(area, geo), [area, geo]);
  const n = sum.hits.length;
  const place = sum.top.slice(0, 2).join(', ') + (sum.top.length > 2 ? ` ${t('map.selection.places', { n: sum.top.length - 2 })}` : '');
  const sub = [sum.countries.length === 1 ? sum.countries[0] : '', n && isFinite(sum.from) ? (fmtMonthYear(sum.from) === fmtMonthYear(sum.to) ? fmtMonthYear(sum.from) : `${fmtMonthYear(sum.from)} – ${fmtMonthYear(sum.to)}`) : ''].filter(Boolean).join(' · ');

  const ui = useUi.getState;
  const close = () => ui().setDraftArea(null);
  return (
    <section className="mp-card glass" aria-label={t('map.selection.title')}>
      <div className="mp-card__top">
        <div className="mp-mosaic" data-n={sum.picks.length} aria-hidden="true">
          {sum.picks.length ? sum.picks.map((p) => <img key={p.id} src={thumbUrl(p, 256)} alt="" draggable={false} style={{ background: p.color }} />) : <span />}
        </div>
        <div className="mp-card__info">
          <div className="mp-card__count tabular">{n ? tn('map.photos', n) : t('map.selection.empty')}</div>
          {place && <div className="mp-card__place truncate">{place}</div>}
          {sub && <div className="mp-card__sub truncate">{sub}</div>}
        </div>
        <IconButton label={t('map.selection.close')} size="sm" onClick={close}><X size={15} strokeWidth={1.75} /></IconButton>
      </div>
      <div className="mp-card__actions">
        <Button variant="primary" size="sm" icon={<FolderPlus size={15} strokeWidth={1.75} />} disabled={!n} onClick={() => ui().setCreateAlbumOpen(true)}>{t('map.selection.album')}</Button>
        <Button size="sm" icon={<ListFilter size={15} strokeWidth={1.75} />} disabled={!n} onClick={() => { ui().setFilters({ area }); ui().setDraftArea(null); }}>{t('map.selection.only')}</Button>
        <Button size="sm" variant="ghost" icon={<SquareCheck size={15} strokeWidth={1.75} />} disabled={!n} onClick={() => { ui().select(sum.hits.map((p) => p.id)); ui().toast(t('map.selection.selected', { n }), { tone: 'success' }); }}>{t('map.selection.select')}</Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ photos in view strip

const THUMB = 64, GAP = 6;

function load(): boolean { try { return localStorage.getItem('iw.map.strip') !== '0'; } catch { return true; } }

export function ViewStrip({ photos }: { photos: Photo[] }) {
  const t = useT();
  const [open, setOpen] = useState(load);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem('iw.map.strip', o ? '0' : '1'); } catch { /* ignore */ } return !o; }); };
  const v = useVirtualizer({ horizontal: true, count: open ? photos.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => THUMB + GAP, overscan: 10 });

  // new viewport -> start at the newest photos again
  const first = photos[0]?.id;
  useEffect(() => { scrollRef.current?.scrollTo({ left: 0 }); }, [first]);

  const ids = useMemo(() => photos.map((p) => p.id), [photos]);
  const ui = useUi.getState;
  return (
    <section className="mp-strip glass" data-open={open} aria-label={t('map.inView')}>
      <div className="mp-strip__head">
        <button className="mp-strip__toggle" onClick={toggle} aria-expanded={open} title={open ? t('map.inView.collapse') : t('map.inView.expand')}>
          {open ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronUp size={16} strokeWidth={1.75} />}
          <span className="tabular">{tn('map.inView.count', photos.length)}</span>
        </button>
      </div>
      {open && (
        <div ref={scrollRef} className="mp-strip__scroll">
          {photos.length === 0 ? <div className="mp-strip__empty">{t('map.inView.empty')}</div> : (
            <div style={{ width: v.getTotalSize(), height: THUMB, position: 'relative' }}>
              {v.getVirtualItems().map((it) => {
                const p = photos[it.index];
                return (
                  <button
                    key={p.id} className="mp-thumb" style={{ transform: `translateX(${it.start}px)`, width: THUMB, background: p.color }}
                    onClick={() => ui().openViewer(ids, it.index)} onMouseEnter={() => ui().setHoverId(p.id)} onMouseLeave={() => ui().setHoverId(null)}
                    aria-label={p.name} title={p.place?.city ?? p.name}
                  >
                    <img src={thumbUrl(p, 256)} alt="" loading="lazy" decoding="async" draggable={false} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
