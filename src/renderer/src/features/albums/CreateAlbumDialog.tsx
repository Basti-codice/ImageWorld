import { useMemo, useState } from 'react';
import { Calendar, MousePointer2, Hexagon, MapPin } from 'lucide-react';
import type { AlbumDraft, Photo } from '@shared/types';
import { Button, Dialog, Switch } from '@/ui';
import { t, tn, useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { photoInArea } from '@/lib/geo';
import Mosaic from './Mosaic';
import ColorSwatches from './ColorSwatches';
import { DEFAULT_ALBUM_COLOR } from './palette';
import { dateRangeLabel, placeSummary, smartAlbumName, timeSpan } from './albumUtils';
import './albums.css';

const byTime = (a: Photo, b: Photo) => a.sortTime - b.sortTime || (a.name < b.name ? -1 : 1);

export default function CreateAlbumDialog() {
  const open = useUi((s) => s.createAlbumOpen);
  return open ? <CreateInner /> : null;
}

function CreateInner() {
  const tt = useT();
  // snapshot of the source at open time: current selection, else the map area, else an empty album
  const [src] = useState(() => {
    const ui = useUi.getState(), lib = useLibrary.getState();
    if (ui.selection.size) {
      const photos = [...ui.selection].map((id) => lib.byId.get(id)).filter(Boolean) as Photo[];
      return { kind: 'selection' as const, photos: photos.sort(byTime), area: null };
    }
    if (ui.draftArea) {
      const area = ui.draftArea;
      return { kind: 'area' as const, photos: lib.photos.filter((p) => photoInArea(p, area)).sort(byTime), area };
    }
    return { kind: 'empty' as const, photos: [] as Photo[], area: null };
  });
  const { photos } = src;
  const suggested = useMemo(() => smartAlbumName(photos), [photos]);
  const [name, setName] = useState(src.kind === 'empty' ? '' : suggested);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_ALBUM_COLOR);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const span = timeSpan(photos);
  const place = placeSummary(photos, 3);

  const close = () => useUi.getState().setCreateAlbumOpen(false);
  const canCreate = !busy && (src.kind === 'empty' ? name.trim().length > 0 : photos.length > 0 || live);

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    const draft: AlbumDraft = {
      name: name.trim() || suggested, description: description.trim() || undefined, color,
      photoIds: photos.map((p) => p.id),
      ...(src.area ? { area: src.area, live } : {}),
    };
    try {
      const album = await window.api.albums.create(draft);
      const ui = useUi.getState();
      ui.clearSelection();
      ui.setDraftArea(null);
      ui.setCreateAlbumOpen(false);
      ui.toast(t('albums.created', { name: album.name }), { tone: 'success', action: { label: t('albums.open'), run: () => useUi.getState().openAlbum(album.id) } });
    } catch {
      setBusy(false);
      useUi.getState().toast(t('albums.error'), { tone: 'danger' });
    }
  };

  return (
    <Dialog title={tt('albums.create.title')} onClose={close}
      footer={<><Button variant="ghost" onClick={close}>{tt('common.cancel')}</Button><Button variant="primary" disabled={!canCreate} onClick={() => void create()}>{tt('common.create')}</Button></>}>
      <div className="ca">
        <div className="ca__preview">
          <Mosaic photos={photos} />
          <span className="ca__badge">
            {src.kind === 'selection' ? <MousePointer2 size={13} /> : src.kind === 'area' ? <Hexagon size={13} /> : null}
            {src.kind === 'empty' ? tt('albums.create.empty') : `${tt(src.kind === 'selection' ? 'albums.create.fromSelection' : 'albums.create.fromArea')} · ${tn('common.photos', photos.length)}`}
          </span>
        </div>
        {(span || place) && (
          <div className="ca__meta">
            {span && <span><Calendar size={14} />{dateRangeLabel(span[0], span[1])}</span>}
            {place && <span><MapPin size={14} />{place}</span>}
          </div>
        )}
        {src.kind === 'empty' && <p style={{ margin: 0, color: 'var(--text-3)' }}>{tt('albums.create.emptyHint')}</p>}
        {src.kind === 'area' && photos.length === 0 && <p style={{ margin: 0, color: 'var(--text-3)' }}>{tt('albums.create.areaEmpty')}</p>}

        <div className="alb-form">
          <label className="alb-form__row"><span>{tt('albums.field.name')}</span>
            <input className="field" autoFocus value={name} maxLength={120} placeholder={suggested} onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
          </label>
          <label className="alb-form__row"><span>{tt('albums.field.description')}</span>
            <textarea className="field" rows={2} value={description} placeholder={tt('albums.description.placeholder')} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="alb-form__row"><span>{tt('albums.color')}</span><ColorSwatches value={color} onChange={setColor} /></div>
          {src.kind === 'area' && (
            <div className="alb-form__row alb-form__switch">
              <div><strong>{tt('albums.live')}</strong><small>{tt('albums.live.hint')}</small></div>
              <Switch checked={live} onChange={setLive} label={tt('albums.live')} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
