import type { Album, Photo } from '@shared/types';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { t, tn } from '@/i18n';

/** Optimistic album update (the backend echoes the change via albums.onChanged). */
export async function updateAlbum(id: string, patch: Partial<Omit<Album, 'id' | 'createdAt'>>): Promise<void> {
  useLibrary.setState((s) => ({ albums: s.albums.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)) }));
  try { await window.api.albums.update(id, patch); } catch { useUi.getState().toast(t('albums.error'), { tone: 'danger' }); }
}

/** Adds photos (skipping duplicates) to a static album and confirms with a toast. */
export async function addToAlbum(album: Album, ids: string[]): Promise<void> {
  const have = new Set(album.photoIds);
  const fresh = ids.filter((id) => !have.has(id));
  if (!fresh.length) { useUi.getState().toast(t('albums.add.already', { name: album.name })); return; }
  await updateAlbum(album.id, { photoIds: [...album.photoIds, ...fresh] });
  useUi.getState().toast(tn('albums.add.done', fresh.length, { name: album.name }), { tone: 'success', action: { label: t('albums.open'), run: () => useUi.getState().openAlbum(album.id) } });
}

export async function removeFromAlbum(album: Album, ids: string[]): Promise<void> {
  const drop = new Set(ids);
  const before = album.photoIds;
  await updateAlbum(album.id, { photoIds: before.filter((id) => !drop.has(id)) });
  useUi.getState().toast(tn('albums.remove.done', ids.length), { action: { label: t('albums.undo'), run: () => { void updateAlbum(album.id, { photoIds: before }); } } });
}

export async function exportAlbum(album: Album): Promise<void> {
  const ui = useUi.getState();
  try {
    const r = await window.api.albums.exportToFolder(album.id);
    if (r.folder == null) return; // cancelled
    if (r.failed) ui.toast(t('albums.export.partial', { copied: r.copied, failed: r.failed }), { tone: 'danger' });
    else ui.toast(tn('albums.export.done', r.copied), { tone: 'success' });
  } catch { ui.toast(t('albums.export.error'), { tone: 'danger' }); }
}

export const isLiveAlbum = (a: Album) => !!(a.live && a.area);
export const coverOf = (a: Album, photos: Photo[]): Photo | undefined =>
  (a.coverPhotoId ? photos.find((p) => p.id === a.coverPhotoId) : undefined);
