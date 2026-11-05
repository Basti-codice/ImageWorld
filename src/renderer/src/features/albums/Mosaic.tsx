import { Images } from 'lucide-react';
import type { Photo } from '@shared/types';
import { thumbUrl } from '@/lib/media';
import { spread } from './albumUtils';

interface Props {
  photos: Photo[];
  /** chosen cover → single full-bleed image */
  cover?: Photo;
  size?: 256 | 512 | 1600;
  /** compact mosaics (previews) use a thinner gap */
  className?: string;
}

/** Album cover: single chosen cover, else a 1/2/3/4-photo mosaic of an even sample of the album. */
export default function Mosaic({ photos, cover, size = 512, className }: Props) {
  const shown = cover ? [cover] : spread(photos, 4);
  return (
    <div className={`mosaic${className ? ` ${className}` : ''}`} data-n={shown.length}>
      {shown.length === 0 ? <div className="mosaic__empty"><Images size={28} strokeWidth={1.5} /></div>
        : shown.map((p) => <img key={p.id} src={thumbUrl(p, size)} alt="" loading="lazy" draggable={false} style={{ background: p.color }} />)}
    </div>
  );
}
