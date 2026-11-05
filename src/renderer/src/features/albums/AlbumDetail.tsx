import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Calendar, ChevronLeft, Download, Globe2, Images, MapPin, MoreHorizontal, Pencil, Play, RefreshCw } from 'lucide-react';
import type { Album } from '@shared/types';
import { Button, EmptyState, IconButton, Menu } from '@/ui';
import { tn, useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { PhotoGrid } from '@/features/photos/PhotoGrid';
import { MiniMap } from '@/features/map/MiniMap';
import { useLibrary } from '@/state/library';
import { useAlbumPhotos } from './useAlbumPhotos';
import { albumBBox, countryCount, dateRangeLabel, geoPhotos, placeSummary, timeSpan } from './albumUtils';
import { albumColor } from './palette';
import { exportAlbum, isLiveAlbum, updateAlbum } from './actions';
import { useAlbumDialogs } from './AlbumDialogs';
import Mosaic from './Mosaic';
import ReorderGrid from './ReorderGrid';
import Slideshow from './Slideshow';
import './albums.css';

export default function AlbumDetail({ album }: { album: Album }) {
  const t = useT();
  const photos = useAlbumPhotos(album);
  const dialogs = useAlbumDialogs();
  const [show, setShow] = useState<{ start: number } | null>(null);
  const [reorder, setReorder] = useState(false);
  const live = isLiveAlbum(album);

  // Esc / Backspace-free navigation: Esc leaves the album unless something else is open
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || show || reorder) return;
      const ui = useUi.getState();
      if (ui.viewer || ui.selection.size || ui.createAlbumOpen || document.querySelector('.dialog-backdrop,.menu')) return;
      ui.openAlbum(null);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [show, reorder]);

  const hero = (
    <Hero album={album} photos={photos} dialogs={dialogs} live={live}
      onSlideshow={() => setShow({ start: 0 })} onReorder={() => setReorder(true)} />
  );

  return (
    <div className="alb-detail" style={{ ['--album-color' as string]: albumColor(album.color) }}>
      {reorder
        ? <ReorderGrid album={album} photos={photos} onDone={() => setReorder(false)} />
        : <PhotoGrid photos={photos} grouped={false} header={hero}
            emptyState={<EmptyState icon={<Images size={40} strokeWidth={1.25} />} title={t('albums.detail.empty.title')} hint={live ? t('albums.detail.empty.live') : t('albums.detail.empty.hint')} />} />}
      {show && <Slideshow photos={photos} start={show.start} title={album.name} onClose={() => setShow(null)} />}
      {dialogs.element}
    </div>
  );
}

function Hero({ album, photos, dialogs, live, onSlideshow, onReorder }: {
  album: Album; photos: ReturnType<typeof useAlbumPhotos>; dialogs: ReturnType<typeof useAlbumDialogs>; live: boolean; onSlideshow(): void; onReorder(): void;
}) {
  const t = useT();
  const cover = useLibrary((s) => (album.coverPhotoId ? s.byId.get(album.coverPhotoId) : undefined));
  const geo = useMemo(() => geoPhotos(photos), [photos]);
  const span = timeSpan(photos);
  const place = placeSummary(photos, 3);
  const countries = countryCount(photos);
  const bbox = useMemo(() => albumBBox(album, photos), [album, photos]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const showOnMap = () => {
    if (!bbox) return;
    const ui = useUi.getState();
    ui.setView('map');
    ui.requestFlyTo({ bbox });
  };

  return (
    <div className="alb-hero">
      <div className="alb-hero__top">
        <Button variant="ghost" size="sm" icon={<ChevronLeft size={16} />} onClick={() => useUi.getState().openAlbum(null)}>{t('nav.albums')}</Button>
      </div>
      <div className="alb-hero__body">
        <div className="alb-hero__cover"><Mosaic photos={photos} cover={cover} size={512} /><i className="alb-card__strip" /></div>

        <div className="alb-hero__text">
          <div className="alb-hero__eyebrow"><i />{live ? t('albums.live') : t('albums.album')}{live && <RefreshCw size={12} strokeWidth={2} />}</div>
          <InlineText className="alb-hero__title" value={album.name} placeholder={t('albums.name.new')} required onCommit={(v) => updateAlbum(album.id, { name: v })} />
          <InlineText className="alb-hero__desc" multiline value={album.description ?? ''} placeholder={t('albums.description.add')} onCommit={(v) => updateAlbum(album.id, { description: v || undefined })} />

          <ul className="alb-hero__facts">
            <li><Images size={15} />{tn('common.photos', photos.length)}</li>
            {span && <li><Calendar size={15} />{dateRangeLabel(span[0], span[1])}</li>}
            {place && <li><MapPin size={15} />{place}</li>}
            {countries > 1 && <li><Globe2 size={15} />{tn('albums.countries', countries)}</li>}
          </ul>

          <div className="alb-hero__actions">
            <Button variant="primary" icon={<Play size={15} fill="currentColor" />} disabled={!photos.length} onClick={onSlideshow}>{t('albums.slideshow')}</Button>
            <Button icon={<MapPin size={16} />} disabled={!bbox} onClick={showOnMap}>{t('albums.showOnMap')}</Button>
            <Button icon={<Download size={16} />} disabled={!photos.length} onClick={() => void exportAlbum(album)}>{t('albums.export')}</Button>
            <Button icon={<Pencil size={16} />} onClick={() => dialogs.edit(album, 'name')}>{t('albums.edit')}</Button>
            {!live && photos.length > 1 && <IconButton label={t('albums.reorder')} onClick={onReorder}><ArrowDownUp size={17} /></IconButton>}
            <IconButton label={t('albums.more')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}><MoreHorizontal size={18} /></IconButton>
          </div>
        </div>

        {geo.length > 0 && (
          <div className="alb-hero__map"><MiniMap photos={geo} route height={196} /></div>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={dialogs.menuItems(album)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Text that reads like a heading/paragraph but edits in place. Enter / blur commit, Esc reverts. */
function InlineText({ value, onCommit, placeholder, multiline, className, required }: {
  value: string; onCommit(v: string): void; placeholder: string; multiline?: boolean; className?: string; required?: boolean;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  const fit = () => { const el = ref.current; if (el) { el.style.height = '0'; el.style.height = `${el.scrollHeight}px`; } };
  useLayoutEffect(fit, [v]);
  useEffect(() => { const h = () => fit(); addEventListener('resize', h); return () => removeEventListener('resize', h); }, []);
  const commit = () => {
    const next = v.trim();
    if (required && !next) { setV(value); return; }
    if (next !== value) onCommit(next); else setV(value);
  };
  return (
    <textarea ref={ref} rows={1} className={`alb-inline ${className ?? ''}`} value={v} placeholder={placeholder} spellCheck={false} maxLength={multiline ? 600 : 120}
      aria-label={placeholder}
      onChange={(e) => setV(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setV(value); (e.target as HTMLElement).blur(); }
        else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
      }} />
  );
}
