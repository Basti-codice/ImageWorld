import { useEffect, useMemo, useRef, useState } from 'react';
import { Images } from 'lucide-react';
import clsx from 'clsx';
import type { Album } from '@shared/types';
import { Button, Dialog } from '@/ui';
import { useT } from '@/i18n';
import { thumbUrl } from '@/lib/media';
import { useAlbumPhotos } from './useAlbumPhotos';
import { updateAlbum } from './actions';
import { albumColor } from './palette';
import ColorSwatches from './ColorSwatches';
import Mosaic from './Mosaic';
import './albums.css';

export type EditFocus = 'name' | 'cover' | 'color';

/** Edit name / description / colour / cover. `focus` decides the title and which section is scrolled into view. */
export default function EditAlbumDialog({ album, focus = 'name', onClose }: { album: Album; focus?: EditFocus; onClose: () => void }) {
  const t = useT();
  const photos = useAlbumPhotos(album);
  const [name, setName] = useState(album.name);
  const [description, setDescription] = useState(album.description ?? '');
  const [color, setColor] = useState(albumColor(album.color));
  const [cover, setCover] = useState<string | undefined>(album.coverPhotoId);
  const coverRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(() => photos.filter((p) => p.kind === 'photo').slice(0, 240), [photos]);

  useEffect(() => {
    if (focus === 'name') nameRef.current?.select();
    else (focus === 'cover' ? coverRef : colorRef).current?.scrollIntoView({ block: 'center' });
  }, [focus]);

  const title = focus === 'cover' ? t('albums.edit.cover') : focus === 'color' ? t('albums.color') : t('albums.edit.title');
  const save = () => {
    const n = name.trim();
    if (!n) return;
    void updateAlbum(album.id, { name: n, description: description.trim() || undefined, color, coverPhotoId: cover });
    onClose();
  };

  return (
    <Dialog title={title} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!name.trim()} onClick={save}>{t('common.save')}</Button></>}>
      <div className="alb-form">
        <label className="alb-form__row"><span>{t('albums.field.name')}</span>
          <input ref={nameRef} className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </label>
        <label className="alb-form__row"><span>{t('albums.field.description')}</span>
          <textarea className="field" rows={2} value={description} placeholder={t('albums.description.placeholder')} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="alb-form__row" ref={colorRef}><span>{t('albums.color')}</span><ColorSwatches value={color} onChange={setColor} /></div>
        <div className="alb-form__row" ref={coverRef}>
          <span>{t('albums.edit.cover')}</span>
          <div className="cover-grid">
            <button type="button" className={clsx('cover-grid__item cover-grid__auto', !cover && 'is-on')} onClick={() => setCover(undefined)} aria-pressed={!cover}>
              <Mosaic photos={photos} size={256} /><em>{t('albums.cover.auto')}</em>
            </button>
            {candidates.map((p) => (
              <button key={p.id} type="button" className={clsx('cover-grid__item', cover === p.id && 'is-on')} onClick={() => setCover(p.id)} aria-pressed={cover === p.id} aria-label={p.name}>
                <img src={thumbUrl(p, 256)} alt="" loading="lazy" draggable={false} style={{ background: p.color }} />
              </button>
            ))}
            {!candidates.length && <div className="cover-grid__none"><Images size={18} />{t('albums.cover.none')}</div>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
