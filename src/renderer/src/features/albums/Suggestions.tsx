import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Photo } from '@shared/types';
import { Button, IconButton } from '@/ui';
import { t, tn, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { detectTrips, type Trip } from '@/lib/trips';
import Mosaic from './Mosaic';
import { dateRangeLabel, smartAlbumName } from './albumUtils';
import './albums.css';

const MAX = 12;

/** Trips/events auto-detected from the library (lib/trips). Hidden entirely when nothing is found or already saved. */
export default function Suggestions() {
  const tt = useT();
  const photos = useLibrary((s) => s.photos);
  const byId = useLibrary((s) => s.byId);
  const albums = useLibrary((s) => s.albums);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // detection can be heavy for large libraries: run after first paint and debounce library changes
  useEffect(() => {
    const h = setTimeout(() => { try { setTrips(detectTrips(photos)); } catch { setTrips([]); } }, 350);
    return () => clearTimeout(h);
  }, [photos]);

  const visible = useMemo(() => {
    const covered = albums.map((a) => new Set(a.photoIds));
    return trips
      .filter((tr) => tr.photoIds.length >= 4 && !hidden.has(tr.id))
      .filter((tr) => !covered.some((set) => { let n = 0; for (const id of tr.photoIds) if (set.has(id)) n++; return n / tr.photoIds.length > 0.6; }))
      .sort((a, b) => b.to - a.to)
      .slice(0, MAX);
  }, [trips, albums, hidden]);

  if (!visible.length) return null;

  const save = async (tr: Trip) => {
    const list = tr.photoIds.map((id) => byId.get(id)).filter(Boolean) as Photo[];
    const name = smartAlbumName(list.length ? list : []) || tr.title;
    setSaving((s) => new Set(s).add(tr.id));
    try {
      const a = await window.api.albums.create({ name, photoIds: tr.photoIds, coverPhotoId: undefined });
      useUi.getState().toast(t('albums.created', { name: a.name }), { tone: 'success', action: { label: t('albums.open'), run: () => useUi.getState().openAlbum(a.id) } });
    } catch { useUi.getState().toast(t('albums.error'), { tone: 'danger' }); }
    setSaving((s) => { const n = new Set(s); n.delete(tr.id); return n; });
  };

  return (
    <section className="alb-sugg" aria-label={tt('albums.suggestions')}>
      <header className="alb-section-head"><h2>{tt('albums.suggestions')}</h2><span>{tt('albums.suggestions.hint')}</span></header>
      <div className="alb-sugg__row">
        {visible.map((tr) => {
          const list = tr.photoIds.map((id) => byId.get(id)).filter(Boolean) as Photo[];
          return (
            <article key={tr.id} className="alb-sugg__card">
              <div className="alb-sugg__cover"><Mosaic photos={list} />
                <IconButton className="alb-sugg__dismiss" size="sm" label={tt('albums.suggestions.dismiss')} onClick={() => setHidden((h) => new Set(h).add(tr.id))}><X size={14} /></IconButton>
              </div>
              <div className="alb-sugg__title truncate">{tr.title}</div>
              <div className="alb-sugg__meta truncate">{tn('common.photos', tr.photoIds.length)} · {dateRangeLabel(tr.from, tr.to, 'day', true)}</div>
              <Button size="sm" icon={<Plus size={14} />} disabled={saving.has(tr.id)} onClick={() => void save(tr)}>{tt('albums.suggestions.save')}</Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
