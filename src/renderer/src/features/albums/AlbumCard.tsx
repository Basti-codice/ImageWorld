import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import type { Album } from '@shared/types';
import { Menu, type MenuItem } from '@/ui';
import { useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useAlbumPhotos } from './useAlbumPhotos';
import { albumMeta, placeSummary } from './albumUtils';
import { albumColor } from './palette';
import { isLiveAlbum } from './actions';
import Mosaic from './Mosaic';
import './albums.css';

interface Props { album: Album; onOpen(): void; menuItems(a: Album): MenuItem[] }

export default function AlbumCard({ album, onOpen, menuItems }: Props) {
  const t = useT();
  const photos = useAlbumPhotos(album);
  const cover = useLibrary((s) => (album.coverPhotoId ? s.byId.get(album.coverPhotoId) : undefined));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const place = placeSummary(photos);

  const openMenu = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };

  return (
    <div className="alb-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={onKey} onContextMenu={openMenu} style={{ ['--album-color' as string]: albumColor(album.color) }}>
      <div className="alb-card__cover">
        <Mosaic photos={photos} cover={cover} />
        <i className="alb-card__strip" />
        <button className="alb-card__more" aria-label={t('albums.more')} title={t('albums.more')}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="alb-card__title">
        <span className="truncate">{album.name}</span>
        {isLiveAlbum(album) && <RefreshCw size={12} strokeWidth={2} aria-label={t('albums.live')}><title>{t('albums.live')}</title></RefreshCw>}
      </div>
      <div className="alb-card__meta truncate">{albumMeta(photos)}</div>
      {place && <div className="alb-card__place truncate">{place}</div>}
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(album)} onClose={() => setMenu(null)} />}
    </div>
  );
}
