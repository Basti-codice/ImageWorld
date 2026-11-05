import { useEffect } from 'react';
import { FolderHeart, Plus } from 'lucide-react';
import { Button, EmptyState } from '@/ui';
import { tn, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import AlbumCard from './AlbumCard';
import AlbumDetail from './AlbumDetail';
import Suggestions from './Suggestions';
import { useAlbumDialogs } from './AlbumDialogs';
import './albums.css';

export default function AlbumsView() {
  const albumId = useUi((s) => s.albumId);
  const albums = useLibrary((s) => s.albums);
  const album = albumId ? albums.find((a) => a.id === albumId) : undefined;
  useEffect(() => { if (albumId && !album) useUi.getState().openAlbum(null); }, [albumId, album]);
  return album ? <AlbumDetail key={album.id} album={album} /> : <AlbumsGrid />;
}

function AlbumsGrid() {
  const t = useT();
  const albums = useLibrary((s) => s.albums);
  const openAlbum = useUi((s) => s.openAlbum);
  const dialogs = useAlbumDialogs();
  const sorted = [...albums].sort((a, b) => b.updatedAt - a.updatedAt);
  const create = () => useUi.getState().setCreateAlbumOpen(true);

  return (
    <div className="alb">
      <header className="alb__head">
        <div>
          <h1>{t('nav.albums')}</h1>
          {albums.length > 0 && <p>{tn('albums.count', albums.length)}</p>}
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={create}>{t('albums.new')}</Button>
      </header>

      <Suggestions />

      {albums.length === 0 ? (
        <EmptyState icon={<FolderHeart size={40} strokeWidth={1.25} />} title={t('albums.empty.title')} hint={t('albums.empty.hint')}
          action={<Button variant="primary" icon={<Plus size={16} />} onClick={create}>{t('albums.new')}</Button>} />
      ) : (
        <>
          <header className="alb-section-head"><h2>{t('albums.mine')}</h2></header>
          <div className="alb-grid">
            {sorted.map((a) => <AlbumCard key={a.id} album={a} onOpen={() => openAlbum(a.id)} menuItems={(x) => dialogs.menuItems(x, { open: true })} />)}
          </div>
        </>
      )}
      {dialogs.element}
    </div>
  );
}
