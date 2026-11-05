import { Check, Plus } from 'lucide-react';
import { useT, tn } from '@/i18n';
import { useLibrary } from '@/state/library';
import { thumbUrl } from '@/lib/media';
import { addToAlbum, isLiveAlbum } from './actions';
import { albumColor } from './palette';
import './albums.css';

interface Props {
  /** photos to add */
  ids: string[];
  /** called after an album was chosen */
  onDone(): void;
  /** "Neues Album…" */
  onNew(): void;
  className?: string;
}

/** Inline popover body: pick an existing (static) album or start a new one. Rendered in place (not portaled) so it also works above the lightbox. */
export default function AlbumPicker({ ids, onDone, onNew, className }: Props) {
  const t = useT();
  const albums = useLibrary((s) => s.albums);
  const byId = useLibrary((s) => s.byId);
  const list = albums.filter((a) => !isLiveAlbum(a)).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className={`albpick ${className ?? ''}`} role="menu" aria-label={t('sel.addToAlbum')}>
      <div className="albpick__list">
        {list.length === 0 && <div className="albpick__empty">{t('albums.picker.empty')}</div>}
        {list.map((a) => {
          const cover = byId.get(a.coverPhotoId ?? a.photoIds[0] ?? '');
          const have = new Set(a.photoIds);
          const all = ids.length > 0 && ids.every((id) => have.has(id));
          return (
            <button key={a.id} role="menuitem" className="albpick__item" onClick={() => { void addToAlbum(a, ids); onDone(); }}>
              <span className="albpick__thumb">{cover && <img src={thumbUrl(cover, 256)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</span>
              <span className="albpick__text"><span className="albpick__name truncate">{a.name}</span><span className="albpick__sub">{tn('common.photos', a.photoIds.length)}</span></span>
              {all ? <Check size={16} style={{ color: 'var(--accent)' }} /> : <i className="albpick__dot" style={{ background: albumColor(a.color) }} />}
            </button>
          );
        })}
      </div>
      <button className="albpick__new" role="menuitem" onClick={() => { onNew(); onDone(); }}><Plus size={16} />{t('albums.picker.new')}</button>
    </div>
  );
}
