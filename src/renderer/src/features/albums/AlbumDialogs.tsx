import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Download, Palette, Pencil, Trash2, FolderOpen, ImageIcon } from 'lucide-react';
import type { Album } from '@shared/types';
import { Button, Dialog, type MenuItem } from '@/ui';
import { t, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import EditAlbumDialog, { type EditFocus } from './EditAlbumDialog';
import { exportAlbum } from './actions';

async function deleteAlbum(album: Album) {
  const ui = useUi.getState();
  if (ui.albumId === album.id) ui.openAlbum(null);
  useLibrary.setState((s) => ({ albums: s.albums.filter((a) => a.id !== album.id) }));
  try { await window.api.albums.remove(album.id); ui.toast(t('albums.delete.done', { name: album.name })); }
  catch { ui.toast(t('albums.error'), { tone: 'danger' }); }
}

function ConfirmDelete({ album, onClose }: { album: Album; onClose: () => void }) {
  const tt = useT();
  return (
    <Dialog title={tt('albums.delete.title', { name: album.name })} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button><Button variant="danger" onClick={() => { void deleteAlbum(album); onClose(); }}>{tt('common.delete')}</Button></>}>
      {tt('albums.delete.body')}
    </Dialog>
  );
}

/** Shared edit/delete dialogs + the context-menu items of an album (grid cards and detail hero). */
export function useAlbumDialogs() {
  const [edit, setEdit] = useState<{ album: Album; focus: EditFocus } | null>(null);
  const [del, setDel] = useState<Album | null>(null);
  const close = useCallback(() => setEdit(null), []);
  const closeDel = useCallback(() => setDel(null), []);

  const menuItems = useCallback((album: Album, opts: { open?: boolean } = {}): MenuItem[] => [
    ...(opts.open ? [{ label: t('albums.open'), icon: <FolderOpen size={16} />, onSelect: () => useUi.getState().openAlbum(album.id) }] : []),
    { label: t('common.rename'), icon: <Pencil size={16} />, onSelect: () => setEdit({ album, focus: 'name' }), separatorBefore: !!opts.open },
    { label: t('albums.edit.cover'), icon: <ImageIcon size={16} />, onSelect: () => setEdit({ album, focus: 'cover' }) },
    { label: t('albums.color'), icon: <Palette size={16} />, onSelect: () => setEdit({ album, focus: 'color' }) },
    { label: t('albums.export'), icon: <Download size={16} />, onSelect: () => { void exportAlbum(album); }, separatorBefore: true },
    { label: t('common.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => setDel(album), separatorBefore: true },
  ], []);

  const element: ReactNode = useMemo(() => (
    <>
      {edit && <EditAlbumDialog album={edit.album} focus={edit.focus} onClose={close} />}
      {del && <ConfirmDelete album={del} onClose={closeDel} />}
    </>
  ), [edit, del, close, closeDel]);

  return { menuItems, edit: (album: Album, focus: EditFocus = 'name') => setEdit({ album, focus }), askDelete: setDel, element };
}
