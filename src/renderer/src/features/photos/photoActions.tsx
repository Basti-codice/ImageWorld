import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Check, FolderOpen, FolderPlus, Heart, HeartOff, ImageUp, MapPin, Maximize2, Plus, Search } from 'lucide-react';
import { Button, Dialog, Menu, type MenuItem } from '@/ui';
import { t, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { thumbUrl } from '@/lib/media';
import { fmtNumber } from '@/lib/format';

/** Toggles the favorite flag for ids: if every photo is already a favorite it removes it, otherwise sets it on all. */
export function toggleFavorite(ids: string[]): boolean {
  const { byId, updatePhotos } = useLibrary.getState();
  const next = !ids.every((id) => byId.get(id)?.favorite);
  void updatePhotos(ids, { favorite: next });
  return next;
}

/** Adds photos to a (non-live) album; toasts the result. */
export async function addToAlbum(albumId: string, ids: string[]) {
  const album = useLibrary.getState().albums.find((a) => a.id === albumId);
  if (!album) return;
  const have = new Set(album.photoIds);
  const fresh = ids.filter((id) => !have.has(id));
  if (!fresh.length) { useUi.getState().toast(t('photos.album.already', { name: album.name })); return; }
  await window.api.albums.update(albumId, { photoIds: [...album.photoIds, ...fresh], ...(album.coverPhotoId ? {} : { coverPhotoId: fresh[0] }) });
  useUi.getState().toast(t('photos.album.added', { n: fresh.length, name: album.name }), { tone: 'success' });
}

function AddToAlbumDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const tr = useT();
  const albums = useLibrary((s) => s.albums);
  const [q, setQ] = useState('');
  const list = useMemo(() => albums.filter((a) => !a.live).filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt), [albums, q]);
  const create = () => { useUi.getState().select(ids, 'replace'); useUi.getState().setCreateAlbumOpen(true); onClose(); };
  return (
    <Dialog title={tr('photos.album.title')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button><Button icon={<Plus size={16} />} onClick={create}>{tr('photos.album.new')}</Button></>}>
      {albums.length > 6 && (
        <label className="pa-search">
          <Search size={15} />
          <input autoFocus className="field" style={{ paddingLeft: 34 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('photos.album.search')} />
        </label>
      )}
      <div className="pa-list" role="list">
        {list.length === 0 && <div className="pa-none">{tr('photos.album.none')}</div>}
        {list.map((a) => (
          <button key={a.id} className="pa-item" role="listitem" onClick={() => { void addToAlbum(a.id, ids); onClose(); }}>
            <span className="pa-item__cover" style={{ background: a.color }}>
              {a.coverPhotoId ? <img src={thumbUrl(a.coverPhotoId, 256)} alt="" /> : <FolderPlus size={16} />}
            </span>
            <span className="pa-item__name truncate">{a.name}</span>
            <span className="pa-item__n tabular">{fmtNumber(a.photoIds.length)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/** Context menu for a set of photos (used by PhotoGrid; exported so other grids can reuse it). */
export function usePhotoContextMenu(openPhoto: (id: string) => void): { show(x: number, y: number, ids: string[]): void; element: ReactNode } {
  const tr = useT();
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [albumFor, setAlbumFor] = useState<string[] | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const { ids } = menu;
    const { byId } = useLibrary.getState();
    const single = ids.length === 1;
    const allFav = ids.every((id) => byId.get(id)?.favorite);
    const out: MenuItem[] = [];
    if (single) out.push({ label: tr('photos.menu.open'), icon: <Maximize2 size={16} />, onSelect: () => openPhoto(ids[0]) });
    out.push({
      label: allFav ? tr('photos.menu.unfav') : tr('photos.menu.fav'), icon: allFav ? <HeartOff size={16} /> : <Heart size={16} />,
      onSelect: () => { toggleFavorite(ids); }, separatorBefore: single,
    });
    out.push({ label: tr('photos.menu.addToAlbum'), icon: <FolderPlus size={16} />, onSelect: () => setAlbumFor(ids), separatorBefore: true });
    if (!single) out.push({ label: tr('photos.menu.newAlbum'), icon: <Plus size={16} />, onSelect: () => { useUi.getState().select(ids, 'replace'); useUi.getState().setCreateAlbumOpen(true); } });
    out.push({ label: tr('photos.menu.place'), icon: <MapPin size={16} />, onSelect: () => useUi.getState().setPlacing(ids) });
    if (single) {
      out.push({ label: tr('photos.menu.reveal'), icon: <FolderOpen size={16} />, onSelect: () => { void window.api.shell.showInFolder(ids[0]); }, separatorBefore: true });
      out.push({ label: tr('photos.menu.original'), icon: <ImageUp size={16} />, onSelect: () => { void window.api.shell.openOriginal(ids[0]); } });
    }
    return out;
  }, [menu, tr, openPhoto]);

  const show = useCallback((x: number, y: number, ids: string[]) => setMenu({ x, y, ids }), []);
  const element = (
    <>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={close} />}
      {albumFor && <AddToAlbumDialog ids={albumFor} onClose={() => setAlbumFor(null)} />}
    </>
  );
  return { show, element };
}

/** tiny check icon used for toggled menu rows */
export const CheckMark = () => <Check size={16} />;
