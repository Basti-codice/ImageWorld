import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Map as MapIcon, Pause, Play, X } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '@shared/types';
import { IconButton, Segmented } from '@/ui';
import { useT } from '@/i18n';
import { thumbUrl } from '@/lib/media';
import { fmtDate } from '@/lib/format';
import { MiniMap } from '@/features/map/MiniMap';
import { countryName } from '@/lib/countries';
import { useLang } from '@/i18n';
import '@/features/viewer/dark.css';
import './slideshow.css';

type Speed = '3' | '5' | '8';
const FADE = 1400;

interface Layer { k: number; i: number; kb: React.CSSProperties; fit: 'cover' | 'contain' }

/** Deterministic-ish Ken-Burns parameters: alternates zoom in/out and drifts in a random direction. */
function kenBurns(n: number, dur: number): React.CSSProperties {
  const r = (a: number) => { const x = Math.sin(n * 12.9898 + a * 78.233) * 43758.5453; return x - Math.floor(x); };
  const zoomIn = n % 2 === 0;
  const s0 = zoomIn ? 1.02 : 1.12, s1 = zoomIn ? 1.12 : 1.02;
  const dx = (r(1) - 0.5) * 5, dy = (r(2) - 0.5) * 4;
  return { ['--kb-s0' as string]: s0, ['--kb-s1' as string]: s1, ['--kb-x0' as string]: `${-dx}%`, ['--kb-y0' as string]: `${-dy}%`, ['--kb-x1' as string]: `${dx}%`, ['--kb-y1' as string]: `${dy}%`, ['--kb-dur' as string]: `${dur}ms` };
}

function fitFor(p: Photo): 'cover' | 'contain' {
  const screen = innerWidth / innerHeight, ratio = p.width / (p.height || 1);
  return Math.abs(Math.log(ratio / screen)) < 0.3 ? 'cover' : 'contain';
}

export default function Slideshow({ photos, start = 0, title, onClose }: { photos: Photo[]; start?: number; title?: string; onClose(): void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [index, setIndex] = useState(Math.min(start, Math.max(0, photos.length - 1)));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>('5');
  const [showMap, setShowMap] = useState(true);
  const [idle, setIdle] = useState(false);
  const interval = +speed * 1000;
  const counter = useRef(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const idleTimer = useRef<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const enteredFs = useRef(false);

  const photo = photos[index];
  const hasGeo = (p?: Photo) => p?.lat != null && p?.lon != null;

  // layer stack: newest on top, previous one removed after the crossfade
  useEffect(() => {
    if (!photo) return;
    const k = ++counter.current;
    setLayers((l) => [...l.slice(-1), { k, i: index, kb: kenBurns(index + k, interval + FADE + 400), fit: fitFor(photo) }]);
    const h = setTimeout(() => setLayers((l) => l.filter((x) => x.k >= k)), FADE + 100);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photo?.id]);

  const go = useCallback((d: number) => setIndex((i) => (i + d + photos.length) % photos.length), [photos.length]);

  // autoplay (loops)
  useEffect(() => {
    if (!playing || photos.length < 2) return;
    const h = setTimeout(() => go(1), interval);
    return () => clearTimeout(h);
  }, [playing, index, interval, go, photos.length]);

  // preload next
  useEffect(() => { if (photos.length > 1) { const img = new Image(); img.src = thumbUrl(photos[(index + 1) % photos.length], 1600); } }, [index, photos]);

  // fullscreen (best effort) – leaving it (Esc is consumed by the browser) ends the show
  useEffect(() => {
    const el = document.documentElement;
    el.requestFullscreen?.().then(() => { enteredFs.current = true; }).catch(() => {});
    const onFs = () => { if (!document.fullscreenElement && enteredFs.current) onClose(); };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      enteredFs.current = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // idle → hide controls + cursor
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2800);
  }, []);
  useEffect(() => { wake(); return () => clearTimeout(idleTimer.current); }, [wake]);

  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop')) return;
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (k === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (k === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (k === 'ArrowUp') { e.preventDefault(); setSpeed((s) => (s === '8' ? '5' : '3')); }
      else if (k === 'ArrowDown') { e.preventDefault(); setSpeed((s) => (s === '3' ? '5' : '8')); }
      else if (k.toLowerCase() === 'm') setShowMap((v) => !v);
      else return;
      wake();
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [go, onClose, wake]);

  const caption = useMemo(() => {
    if (!photo) return { place: '', date: '' };
    const place = photo.place ? [photo.place.city, countryName(photo.place.countryCode, lang, photo.place.country)].filter(Boolean).join(', ') : '';
    return { place, date: fmtDate(photo.sortTime) };
  }, [photo, lang]);

  if (!photo) return null;
  const mapOn = showMap && hasGeo(photo);

  return createPortal(
    <div ref={rootRef} className={clsx('ss iw-dark', idle && 'is-idle')} role="dialog" aria-modal="true" aria-label={title ?? t('albums.slideshow')} onMouseMove={wake} onMouseDown={wake}>
      <div className="ss__stage" onClick={() => setPlaying((p) => !p)}>
        {layers.map((l) => {
          const p = photos[l.i]; if (!p) return null;
          return (
            <div key={l.k} className="ss__layer" style={p.color ? { background: `color-mix(in srgb, ${p.color} 42%, #000)` } : undefined}>
              <img className="ss__img" data-fit={l.fit} src={thumbUrl(p, 1600)} alt="" draggable={false} style={l.kb} />
            </div>
          );
        })}
      </div>
      <div className="ss__scrim ss__scrim--top" />
      <div className="ss__scrim ss__scrim--bottom" />

      <div className="ss__top">
        <IconButton glass label={t('albums.slideshow.exit')} onClick={onClose}><X size={18} /></IconButton>
        <div className="ss__title truncate">{title}</div>
        <div className="ss__top-right">
          <Segmented<Speed> value={speed} onChange={setSpeed} options={[
            { value: '8', label: t('albums.slideshow.slow') }, { value: '5', label: t('albums.slideshow.normal') }, { value: '3', label: t('albums.slideshow.fast') },
          ]} />
          <IconButton glass active={showMap} aria-pressed={showMap} label={t('albums.slideshow.map')} onClick={() => setShowMap((v) => !v)}><MapIcon size={17} /></IconButton>
        </div>
      </div>

      <div className="ss__caption" key={photo.id}>
        {caption.place && <div className="ss__place">{caption.place}</div>}
        <div className="ss__date">{caption.date}<span className="tabular"> · {index + 1} / {photos.length}</span></div>
      </div>

      <div className="ss__controls">
        <IconButton glass size="lg" label={t('viewer.prev')} onClick={() => go(-1)}><ChevronLeft size={20} /></IconButton>
        <IconButton glass size="lg" label={playing ? t('albums.slideshow.pause') : t('albums.slideshow.play')} onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </IconButton>
        <IconButton glass size="lg" label={t('viewer.next')} onClick={() => go(1)}><ChevronRight size={20} /></IconButton>
      </div>

      {mapOn && (
        <div className="ss__map"><MiniMap photos={[photo]} activeId={photo.id} height={180} /></div>
      )}

      <div className="ss__progress">{playing && photos.length > 1 && <i key={`${index}-${speed}`} style={{ animationDuration: `${interval}ms` }} />}</div>
    </div>, document.body);
}
