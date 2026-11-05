import { useState, type DragEvent } from 'react';
import { GripVertical } from 'lucide-react';
import clsx from 'clsx';
import type { Album, Photo } from '@shared/types';
import { Button } from '@/ui';
import { useT } from '@/i18n';
import { thumbUrl } from '@/lib/media';
import { updateAlbum } from './actions';
import './albums.css';

/** Drag & drop ordering of a static album (HTML5 DnD, no extra dependency). */
export default function ReorderGrid({ album, photos, onDone }: { album: Album; photos: Photo[]; onDone(): void }) {
  const t = useT();
  const [order, setOrder] = useState(() => photos.map((p) => p.id));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const byId = new Map(photos.map((p) => [p.id, p]));

  const move = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    setOrder((o) => {
      const rest = o.filter((x) => x !== id);
      const at = rest.indexOf(target) + (after ? 1 : 0);
      rest.splice(at, 0, id);
      return rest;
    });
  };
  const onOver = (e: DragEvent<HTMLElement>, id: string) => {
    if (!drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver({ id, after: e.clientX > r.left + r.width / 2 });
  };
  const done = (save: boolean) => {
    if (save) {
      const known = new Set(order);
      void updateAlbum(album.id, { photoIds: [...order, ...album.photoIds.filter((id) => !known.has(id))] });
    }
    onDone();
  };

  return (
    <div className="alb-reorder">
      <div className="alb-reorder__bar">
        <div><strong>{t('albums.reorder')}</strong><span>{t('albums.reorder.hint')}</span></div>
        <div className="alb-reorder__btns"><Button variant="ghost" onClick={() => done(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => done(true)}>{t('common.done')}</Button></div>
      </div>
      <div className="alb-reorder__grid">
        {order.map((id, i) => {
          const p = byId.get(id); if (!p) return null;
          const mark = over?.id === id && drag !== id ? (over.after ? 'after' : 'before') : undefined;
          return (
            <figure key={id} draggable className={clsx('alb-reorder__tile', drag === id && 'is-drag', mark && `is-${mark}`)}
              onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
              onDragOver={(e) => onOver(e, id)}
              onDrop={(e) => { e.preventDefault(); if (drag && over) move(drag, over.id, over.after); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}>
              <img src={thumbUrl(p, 256)} alt="" loading="lazy" draggable={false} style={{ background: p.color }} />
              <figcaption className="tabular">{i + 1}</figcaption>
              <GripVertical size={14} className="alb-reorder__grip" />
            </figure>
          );
        })}
      </div>
    </div>
  );
}
