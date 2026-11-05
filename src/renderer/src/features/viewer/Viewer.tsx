import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FolderHeart, FolderOpen, Heart, Info, MapPin, Minus, Plus, X, Star } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from '@/ui';
import { useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { thumbUrl } from '@/lib/media';
import { fmtDate, fmtTime } from '@/lib/format';
import AlbumPicker from '@/features/albums/AlbumPicker';
import Slide from './Slide';
import Filmstrip from './Filmstrip';
import InfoPanel from './InfoPanel';
import { useZoomPan } from './useZoomPan';
import './dark.css';
import './viewer.css';

const INFO_KEY = 'iw.viewer.info';
const readInfo = () => { try { return localStorage.getItem(INFO_KEY) === '1'; } catch { return false; } };

export default function Viewer() {
  const viewer = useUi((s) => s.viewer);
  return viewer ? <Lightbox ids={viewer.ids} index={Math.min(Math.max(0, viewer.index), viewer.ids.length - 1)} /> : null;
}

type Hud = { n: number; icon: 'star' | 'heart' | 'none'; text: string };

function Lightbox({ ids, index }: { ids: string[]; index: number }) {
  const t = useT();
  const photo = useLibrary((s) => s.byId.get(ids[index]));
  const byId = useLibrary((s) => s.byId);
  const update = useLibrary((s) => s.updatePhotos);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const zp = useZoomPan(stageRef, photo);
  const { view } = zp;

  const [leaving, setLeaving] = useState(false);
  const [info, setInfo] = useState(readInfo);
  const [chrome, setChrome] = useState(true);
  const [pop, setPop] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number>(0);
  const hudTimer = useRef<number>(0);
  const prevIndex = useRef(index);
  const instant = Math.abs(index - prevIndex.current) > 1; // far jumps (filmstrip) skip the slide animation
  useLayoutEffect(() => { prevIndex.current = index; });

  const isVideo = photo?.kind === 'video';
  const zoomed = view.z > 1.05;

  /* ---------- navigation ---------- */
  const go = useCallback((i: number) => {
    const n = Math.min(ids.length - 1, Math.max(0, i));
    if (n !== index) useUi.getState().setViewerIndex(n);
  }, [ids.length, index]);

  const close = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => useUi.getState().closeViewer(), 190);
  }, [leaving]);

  /* ---------- chrome auto-hide ---------- */
  const wake = useCallback(() => {
    setChrome(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setChrome(false), 3600);
  }, []);
  useEffect(() => { wake(); return () => { clearTimeout(idleTimer.current); clearTimeout(hudTimer.current); }; }, [wake]);

  const flash = useCallback((text: string, icon: Hud['icon'] = 'none') => {
    setHud({ n: Date.now(), icon, text });
    clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(null), 1300);
  }, []);

  /* ---------- preload neighbours ---------- */
  useEffect(() => {
    for (const d of [1, -1, 2, -2]) {
      const id = ids[index + d]; if (!id) continue;
      const img = new Image(); img.src = thumbUrl(id, 1600);
    }
  }, [ids, index]);

  /* ---------- actions ---------- */
  const toggleInfo = useCallback(() => setInfo((v) => { const n = !v; try { localStorage.setItem(INFO_KEY, n ? '1' : '0'); } catch { /* storage unavailable */ } return n; }), []);
  const toggleFav = useCallback(() => {
    if (!photo) return;
    void update([photo.id], { favorite: !photo.favorite });
    flash(photo.favorite ? t('viewer.fav.off') : t('viewer.fav.on'), 'heart');
  }, [photo, update, flash, t]);
  const rate = useCallback((n: number) => {
    if (!photo) return;
    void update([photo.id], { rating: n });
    flash(n ? t('viewer.rating.set', { n }) : t('viewer.rating.clear'), 'star');
  }, [photo, update, flash, t]);
  const assignPlace = useCallback(() => {
    if (!photo) return;
    useUi.getState().setPlacing([photo.id]);
    close();
  }, [photo, close]);
  const newAlbum = useCallback(() => {
    if (!photo) return;
    const ui = useUi.getState(), prev = ui.selection;
    ui.select([photo.id], 'replace');
    ui.setCreateAlbumOpen(true);
    const unsub = useUi.subscribe((s) => {
      if (s.createAlbumOpen) return;
      unsub();
      if (s.selection.size === 1 && s.selection.has(photo.id)) useUi.setState({ selection: prev }); // cancelled → restore
    });
  }, [photo]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.isContentEditable);
      if (typing) return;
      if (document.querySelector('.dialog-backdrop') || useUi.getState().commandPaletteOpen) return;
      if (el?.tagName === 'INPUT') (el as HTMLInputElement).blur();
      const k = e.key;
      let handled = true;
      if (k === 'Escape') { if (pop) setPop(false); else if (zp.ref.current.z > 1.02) zp.reset(); else close(); }
      else if (k === 'ArrowRight') go(index + 1);
      else if (k === 'ArrowLeft') go(index - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(ids.length - 1);
      else if (k === ' ') { if (isVideo) { const v = videoRef.current; if (v) { if (v.paused) void v.play().catch(() => {}); else v.pause(); } } else go(index + 1); }
      else if (k === 'i' || k === 'I') toggleInfo();
      else if (k === 'f' || k === 'F') toggleFav();
      else if (k === 'z' || k === 'Z') { if (!isVideo) zp.toggle(); }
      else if (k === '+' || k === '=') { if (!isVideo) zp.zoomAt(1.4, 0, 0, true); }
      else if (k === '-' || k === '_') { if (!isVideo) zp.zoomAt(1 / 1.4, 0, 0, true); }
      else if (/^[0-5]$/.test(k)) rate(+k);
      else handled = false;
      if (handled) { e.preventDefault(); wake(); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [index, ids.length, isVideo, pop, zp, go, close, toggleInfo, toggleFav, rate, wake]);

  /* ---------- wheel zoom (needs a non-passive listener) ---------- */
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.vw-video')) return;
      e.preventDefault();
      if (isVideo) return;
      const { px, py } = zp.toLocal(e.clientX, e.clientY);
      zp.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), px, py);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [zp, isVideo]);

  /* ---------- pointer gestures: pan, pinch, swipe ---------- */
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ mode: 'none' | 'pan' | 'swipe' | 'pinch'; sx: number; sy: number; moved: boolean; dist: number; mx: number; my: number }>({ mode: 'none', sx: 0, sy: 0, moved: false, dist: 0, mx: 0, my: 0 });

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.vw-video__bar, .vw-video__big')) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (pts.current.size === 2 && !isVideo) {
      const [a, b] = [...pts.current.values()];
      s.mode = 'pinch'; s.dist = Math.hypot(a.x - b.x, a.y - b.y); s.mx = (a.x + b.x) / 2; s.my = (a.y + b.y) / 2; s.moved = true;
      setDragX(0); setDragging(false);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (pts.current.size === 1) {
      s.mode = zp.ref.current.z > 1.02 ? 'pan' : 'swipe'; s.sx = s.mx = e.clientX; s.sy = s.my = e.clientY; s.moved = false;
    }
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    wake();
    const p = pts.current.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const s = g.current;
    if (s.mode === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const { px, py } = zp.toLocal(mx, my);
      zp.zoomAt(dist / (s.dist || dist), px, py);
      zp.panBy(mx - s.mx, my - s.my);
      s.dist = dist; s.mx = mx; s.my = my;
    } else if (s.mode === 'pan') {
      if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < 3) return;
      if (!s.moved) e.currentTarget.setPointerCapture(e.pointerId);
      s.moved = true;
      zp.panBy(e.clientX - s.mx, e.clientY - s.my);
      s.mx = e.clientX; s.my = e.clientY;
    } else if (s.mode === 'swipe') {
      const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
      if (!s.moved) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
        s.moved = true; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId);
      }
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === ids.length - 1);
      setDragX(atEdge ? dx / 4 : dx);
    }
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    const s = g.current;
    if (s.mode === 'swipe' && s.moved) {
      const w = stageRef.current?.clientWidth ?? 800;
      if (Math.abs(dragX) > Math.min(110, w * 0.15)) go(index + (dragX < 0 ? 1 : -1));
      setDragX(0); setDragging(false);
    }
    if (s.mode === 'pinch' && pts.current.size < 2) {
      if (zp.ref.current.z < 1.05) zp.reset(true);
      s.mode = 'none';
    }
    if (pts.current.size === 0) s.mode = 'none';
  };

  /* ---------- popover: close on outside click ---------- */
  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setPop(false); };
    addEventListener('mousedown', down, true);
    return () => removeEventListener('mousedown', down, true);
  }, [pop]);

  /* ---------- window of rendered slides ---------- */
  const slides = useMemo(() => {
    const out: Array<{ i: number; id: string }> = [];
    for (let i = Math.max(0, index - 1); i <= Math.min(ids.length - 1, index + 1); i++) out.push({ i, id: ids[i] });
    return out;
  }, [ids, index]);

  const dateLine = photo ? [fmtDate(photo.sortTime), photo.takenAt != null ? fmtTime(photo.takenAt) : null].filter(Boolean).join(' · ') : '';
  const pct = photo ? zp.percent(view.z) : 100;
  const showFilm = ids.length > 1;

  return (
    <div ref={rootRef} className={clsx('vw iw-dark', leaving && 'is-leaving', info && 'has-info', !chrome && 'is-idle')} role="dialog" aria-modal="true" aria-label={photo?.name ?? t('viewer.title')}
      onMouseMove={wake} onMouseDown={() => { wake(); }}>
      <div className="vw-main">
        <div ref={stageRef} className={clsx('vw-stage', zoomed && 'is-zoomed', dragging && 'is-dragging')}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onDoubleClick={(e) => { if (isVideo || (e.target as HTMLElement).closest('.vw-video__bar')) return; const { px, py } = zp.toLocal(e.clientX, e.clientY); zp.toggle(px, py); }}>
          <div className="vw-track" style={{ ['--i' as string]: index, ['--dx' as string]: `${dragX}px`, transition: dragging || instant ? 'none' : undefined }}>
            {slides.map(({ i, id }) => {
              const p = byId.get(id); if (!p) return null;
              return <Slide key={id} photo={p} index={i} current={i === index} view={i === index ? view : undefined} zoomed={zoomed} videoRef={videoRef} />;
            })}
          </div>
        </div>

        {/* top bar */}
        <header className="vw-top">
          <div className="vw-top__left">
            <IconButton label={`${t('viewer.close')} (Esc)`} onClick={close}><X size={18} /></IconButton>
            {photo && (
              <div className="vw-title">
                <div className="vw-title__name truncate">{photo.name}</div>
                <div className="vw-title__sub truncate">{dateLine}</div>
              </div>
            )}
          </div>
          <div className="vw-counter tabular">{index + 1} <span>/ {ids.length}</span></div>
          <div className="vw-top__right">
            {photo && (
              <>
                <IconButton label={`${t('viewer.favorite')} (F)`} active={photo.favorite} aria-pressed={photo.favorite} className={clsx(photo.favorite && 'is-fav')} onClick={toggleFav}>
                  <Heart size={18} fill={photo.favorite ? 'currentColor' : 'none'} />
                </IconButton>
                <div className="vw-anchor" ref={popRef}>
                  <IconButton label={t('sel.addToAlbum')} active={pop} aria-expanded={pop} onClick={() => setPop((v) => !v)}><FolderHeart size={18} /></IconButton>
                  {pop && <AlbumPicker className="vw-pop" ids={[photo.id]} onDone={() => setPop(false)} onNew={newAlbum} />}
                </div>
                <IconButton label={photo.lat == null ? t('viewer.place.assign') : t('viewer.place.change')} onClick={assignPlace}><MapPin size={18} /></IconButton>
                <IconButton label={t('viewer.showInFolder')} onClick={() => void window.api.shell.showInFolder(photo.id)}><FolderOpen size={18} /></IconButton>
                <IconButton label={t('viewer.openOriginal')} onClick={() => void window.api.shell.openOriginal(photo.id)}><ExternalLink size={18} /></IconButton>
                <i className="vw-sep" />
              </>
            )}
            <IconButton label={`${t('viewer.info')} (I)`} active={info} aria-pressed={info} onClick={toggleInfo}><Info size={18} /></IconButton>
          </div>
        </header>

        {/* prev / next */}
        {index > 0 && <IconButton glass size="lg" className="vw-nav vw-nav--prev" label={`${t('viewer.prev')} (←)`} onClick={() => go(index - 1)}><ChevronLeft size={22} /></IconButton>}
        {index < ids.length - 1 && <IconButton glass size="lg" className="vw-nav vw-nav--next" label={`${t('viewer.next')} (→)`} onClick={() => go(index + 1)}><ChevronRight size={22} /></IconButton>}

        {/* bottom: zoom + filmstrip */}
        <footer className="vw-bottom">
          {photo && !isVideo && (
            <div className="vw-zoombar glass" role="group" aria-label={t('viewer.zoom')}>
              <IconButton size="sm" label={`${t('viewer.zoom.out')} (−)`} disabled={view.z <= 1.001} onClick={() => zp.zoomAt(1 / 1.4, 0, 0, true)}><Minus size={15} /></IconButton>
              <button className="vw-zoombar__val tabular" title={`${zoomed ? t('viewer.zoom.fit') : t('viewer.zoom.100')} (Z)`} onClick={() => zp.toggle()}>{pct}%</button>
              <IconButton size="sm" label={`${t('viewer.zoom.in')} (+)`} onClick={() => zp.zoomAt(1.4, 0, 0, true)}><Plus size={15} /></IconButton>
            </div>
          )}
          {showFilm && <Filmstrip ids={ids} index={index} onSelect={go} />}
        </footer>

        {hud && (
          <div className="vw-hud" key={hud.n} role="status">
            {hud.icon === 'star' && <Star size={15} fill="currentColor" />}
            {hud.icon === 'heart' && <Heart size={15} fill="currentColor" />}
            {hud.text}
          </div>
        )}
        {!photo && <div className="vw-fail">{t('viewer.error.missing')}</div>}
      </div>

      {photo && <InfoPanel photo={photo} open={info} onClose={toggleInfo} onAssignPlace={assignPlace} />}
    </div>
  );
}
