import { useMemo } from 'react';
import type { Album, Photo } from '@shared/types';
import { useLibrary } from '@/state/library';
import { photoInArea } from '@/lib/geo';

/** Resolves an album's photos. Static albums keep their stored order (missing files are skipped);
 *  live area albums are re-evaluated against the whole library (chronological). */
export function resolveAlbumPhotos(album: Album | null | undefined, photos: Photo[], byId: Map<string, Photo>): Photo[] {
  if (!album) return [];
  if (album.live && album.area) {
    const area = album.area;
    return photos.filter((p) => photoInArea(p, area)).sort((a, b) => a.sortTime - b.sortTime || (a.name < b.name ? -1 : 1));
  }
  const out: Photo[] = [];
  for (const id of album.photoIds) { const p = byId.get(id); if (p) out.push(p); }
  return out;
}

/** Shared hook: the photos of an album in display order. Memoised on the album/library identity. */
export function useAlbumPhotos(album: Album | null | undefined): Photo[] {
  const photos = useLibrary((s) => s.photos);
  const byId = useLibrary((s) => s.byId);
  return useMemo(() => resolveAlbumPhotos(album, photos, byId), [album, photos, byId]);
}
