import type { Photo, ThumbSize } from '@shared/types';
import { THUMB_PROTOCOL, FILE_PROTOCOL } from '@shared/types';
import { mockThumb } from '@/api/mock';

const isWeb = () => window.api?.platform === 'web';

/** URL of a cached thumbnail (256 grid / 512 cards / 1600 viewer preview). Always use this – never build URLs by hand. */
export function thumbUrl(photoOrId: Photo | string, size: ThumbSize = 256): string {
  const id = typeof photoOrId === 'string' ? photoOrId : photoOrId.id;
  return isWeb() ? mockThumb(id, size) : `${THUMB_PROTOCOL}://${id}/${size}`;
}

/** URL of the original file (images + videos, supports range requests). */
export function originalUrl(photoOrId: Photo | string): string {
  const id = typeof photoOrId === 'string' ? photoOrId : photoOrId.id;
  return isWeb() ? mockThumb(id, 1600) : `${FILE_PROTOCOL}://${id}`;
}
