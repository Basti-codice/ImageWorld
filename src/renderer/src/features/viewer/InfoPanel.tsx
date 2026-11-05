import { useMemo, type ReactNode } from 'react';
import { Calendar, Camera, Copy, File as FileIcon, Heart, MapPin, MapPinOff, X } from 'lucide-react';
import type { Photo } from '@shared/types';
import { Button, IconButton } from '@/ui';
import { useLang, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { MiniMap } from '@/features/map/MiniMap';
import { countryName } from '@/lib/countries';
import { fmtBytes, fmtCoord, fmtDate, fmtDuration, fmtNumber, fmtTime } from '@/lib/format';
import Stars from './Stars';
import TagEditor from './TagEditor';

function Section({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return <section className="info__sec"><h3>{icon}{title}</h3>{children}</section>;
}

interface Props { photo: Photo; open: boolean; onClose(): void; onAssignPlace(): void }

export default function InfoPanel({ photo, open, onClose, onAssignPlace }: Props) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const update = useLibrary((s) => s.updatePhotos);
  const p = photo;
  const hasGeo = p.lat != null && p.lon != null;
  const mp = (p.width * p.height) / 1e6;
  const country = p.place ? countryName(p.place.countryCode, lang, p.place.country) : '';
  const exif = useMemo(() => [
    p.iso != null && { k: 'ISO', v: String(p.iso) },
    p.aperture != null && { k: t('viewer.info.aperture'), v: `ƒ/${p.aperture}` },
    p.shutter && { k: t('viewer.info.shutter'), v: `${p.shutter} s` },
    p.focalLength != null && { k: t('viewer.info.focal'), v: `${p.focalLength} mm` },
  ].filter(Boolean) as Array<{ k: string; v: string }>, [p, t]);

  const copyCoords = () => { if (hasGeo) { void navigator.clipboard?.writeText(`${p.lat!.toFixed(6)}, ${p.lon!.toFixed(6)}`).then(() => useUi.getState().toast(t('viewer.info.copied')), () => {}); } };

  return (
    <aside className="vw-panel" data-open={open} aria-hidden={!open} aria-label={t('viewer.info')} inert={!open}>
      <header className="vw-panel__head">
        <h2>{t('viewer.info')}</h2>
        <IconButton size="sm" label={t('viewer.info.close')} onClick={onClose}><X size={16} /></IconButton>
      </header>
      <div className="vw-panel__scroll">
        <div className="info__top">
          <Stars value={p.rating} onChange={(v) => void update([p.id], { rating: v })} />
          <IconButton label={t('viewer.favorite')} active={p.favorite} aria-pressed={p.favorite} style={p.favorite ? { color: 'var(--fav)', background: 'transparent' } : undefined}
            onClick={() => void update([p.id], { favorite: !p.favorite })}><Heart size={18} fill={p.favorite ? 'currentColor' : 'none'} /></IconButton>
        </div>

        <Section title={t('viewer.tags')}>
          <TagEditor tags={p.tags}
            onAdd={(tag) => void update([p.id], { tags: [...p.tags, tag] })}
            onRemove={(tag) => void update([p.id], { tags: p.tags.filter((x) => x !== tag) })} />
        </Section>

        <Section icon={<Calendar size={13} />} title={t('viewer.info.date')}>
          <div className="info__big">{fmtDate(p.sortTime, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div className="info__sub tabular">{p.takenAt != null ? t('viewer.info.time', { time: fmtTime(p.takenAt) }) : t('viewer.info.modified')}</div>
        </Section>

        <Section icon={<MapPin size={13} />} title={t('viewer.info.place')}>
          {hasGeo ? (
            <>
              {p.place && <div className="info__big">{p.place.city}</div>}
              {p.place && <div className="info__sub">{[p.place.region, country].filter(Boolean).join(', ')}</div>}
              <button className="info__coords tabular" onClick={copyCoords} title={t('viewer.info.copy')}>{fmtCoord(p.lat!, p.lon!)}<Copy size={12} /></button>
              <div className="info__map"><MiniMap photos={[p]} activeId={p.id} height={156} /></div>
              <div className="info__row-actions">
                <span className="info__src">{p.geoSource === 'manual' ? t('viewer.info.geo.manual') : t('viewer.info.geo.exif')}</span>
                {p.geoSource === 'manual' && (
                  <>
                    <Button size="sm" variant="ghost" icon={<MapPin size={14} />} onClick={onAssignPlace}>{t('viewer.place.change')}</Button>
                    <Button size="sm" variant="ghost" icon={<MapPinOff size={14} />} onClick={() => void update([p.id], { location: null })}>{t('viewer.place.remove')}</Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="info__noplace">
              <span>{t('viewer.info.noplace')}</span>
              <Button size="sm" icon={<MapPin size={14} />} onClick={onAssignPlace}>{t('viewer.place.assign')}</Button>
            </div>
          )}
        </Section>

        {(p.camera || p.lens || exif.length > 0) && (
          <Section icon={<Camera size={13} />} title={t('viewer.info.camera')}>
            {p.camera && <div className="info__big">{p.camera}</div>}
            {p.lens && <div className="info__sub">{p.lens}</div>}
            {exif.length > 0 && <dl className="info__exif">{exif.map((e) => <div key={e.k}><dt>{e.k}</dt><dd className="tabular">{e.v}</dd></div>)}</dl>}
          </Section>
        )}

        <Section icon={<FileIcon size={13} />} title={t('viewer.info.file')}>
          <div className="info__big info__name">{p.name}</div>
          <dl className="info__kv">
            <div><dt>{t('viewer.info.resolution')}</dt><dd className="tabular">{fmtNumber(p.width)} × {fmtNumber(p.height)}{p.kind === 'photo' && mp >= 0.1 ? ` · ${mp.toFixed(1)} MP` : ''}</dd></div>
            <div><dt>{t('viewer.info.size')}</dt><dd className="tabular">{fmtBytes(p.size)}</dd></div>
            <div><dt>{t('viewer.info.type')}</dt><dd>{p.ext.toUpperCase()} · {p.kind === 'video' ? t('viewer.info.video') : t('viewer.info.photo')}</dd></div>
            {p.duration != null && <div><dt>{t('viewer.info.duration')}</dt><dd className="tabular">{fmtDuration(p.duration)}</dd></div>}
          </dl>
          <button className="info__path" onClick={() => void window.api.shell.showInFolder(p.id)} title={t('viewer.showInFolder')}>{p.path}</button>
        </Section>
      </div>
    </aside>
  );
}
