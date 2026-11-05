import './onboarding.css';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FolderHeart, FolderOpen, Map as MapIcon, Play, ShieldCheck } from 'lucide-react';
import type { SourceKind } from '@shared/types';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { useT, tn } from '@/i18n';
import { fmtNumber } from '@/lib/format';
import { thumbUrl } from '@/lib/media';
import { Button, ProgressBar, Spinner } from '@/ui';
import { Logo } from '@/ui/Logo';
import { SourceIcon, addFolderPath, phaseLabel, pickFolders } from '@/shell/sources';
import { landDots, locationDots } from './world';

/** Faint dotted world; located photos light up in the accent colour as they are found. */
const World = memo(function World({ points }: { points: Array<[number, number]> }) {
  const { d, width, height } = useMemo(() => landDots(), []);
  return (
    <svg className="onb__world" viewBox={`0 0 ${width} ${height}`} aria-hidden preserveAspectRatio="xMidYMid meet">
      <path className="onb__land" d={d} />
      {points.map(([x, y], i) => <circle key={i} className="onb__loc" cx={x} cy={y} r={3.2} style={{ animationDelay: `${(i % 12) * 40}ms` }} />)}
    </svg>
  );
});

export default function Onboarding() {
  const sources = useLibrary((s) => s.sources);
  const photos = useDeferredValue(useLibrary((s) => s.photos));
  const progress = useLibrary((s) => s.progress);
  const hasSources = sources.length > 0;

  const geoPoints = useMemo(() => {
    if (!hasSources) return [];
    const coords: Array<[number, number]> = [];
    const stride = Math.max(1, Math.floor(photos.length / 4000));
    for (let i = 0; i < photos.length; i += stride) { const p = photos[i]; if (p.lat != null && p.lon != null) coords.push([p.lat, p.lon]); }
    return locationDots(coords);
  }, [photos, hasSources]);

  return (
    <div className="onb">
      <World points={geoPoints} />
      <div className="onb__veil" />
      <div className="onb__col">
        {hasSources ? <Progress photos={photos} progress={progress} /> : <Welcome />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step 1 */
function Welcome() {
  const t = useT();
  const [suggestions, setSuggestions] = useState<Array<{ label: string; path: string; kind: SourceKind }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { let alive = true; window.api.sources.suggestions().then((s) => { if (alive) setSuggestions(s); }).catch(() => {}); return () => { alive = false; }; }, []);

  return (
    <>
      <Logo size={40} />
      <h1 className="onb__title"><span>{t('onboarding.title.a')}</span> <span className="onb__title2">{t('onboarding.title.b')}</span></h1>
      <p className="onb__lead">{t('onboarding.lead')}</p>

      <div className="onb__cta">
        <Button variant="primary" size="lg" icon={<FolderOpen size={18} />} data-autofocus onClick={() => { void pickFolders(); }}>{t('onboarding.pick')}</Button>
        <span className="onb__or">{t('onboarding.drop')}</span>
      </div>

      {suggestions.length > 0 && (
        <div className="onb__suggest">
          <div className="onb__label">{t('onboarding.suggestions')}</div>
          <ul>
            {suggestions.slice(0, 3).map((s) => (
              <li key={s.path}>
                <button type="button" className="onb__sug" disabled={busy != null} onClick={async () => { setBusy(s.path); await addFolderPath(s.path); setBusy(null); }}>
                  <span className="onb__sugicon"><SourceIcon kind={s.kind} size={18} /></span>
                  <span className="onb__sugtext"><span className="onb__sugname">{s.label}</span><span className="onb__sugpath truncate">{s.path}</span></span>
                  <span className="onb__sugact">{busy === s.path ? <Spinner size={14} /> : <>{t('onboarding.add')}<ArrowRight size={14} /></>}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="onb__hints">
        {([['map', MapIcon], ['timeline', Play], ['albums', FolderHeart]] as const).map(([k, Icon]) => (
          <li key={k}><Icon size={16} /><b>{t(`onboarding.hint.${k}`)}</b><span>{t(`onboarding.hint.${k}.d`)}</span></li>
        ))}
      </ul>
      <div className="onb__privacy"><ShieldCheck size={14} />{t('onboarding.privacy')}</div>
    </>
  );
}

/* ------------------------------------------------------------------ step 2: first scan */
function Progress({ photos, progress }: { photos: ReturnType<typeof useLibrary.getState>['photos']; progress: ReturnType<typeof useLibrary.getState>['progress'] }) {
  const t = useT();
  const sources = useLibrary((s) => s.sources);
  const setSettings = useLibrary((s) => s.setSettings);
  const setView = useUi((s) => s.setView);

  const active = Object.values(progress).filter((p) => p.phase !== 'done');
  const scanning = active.length > 0 || sources.some((s) => s.status === 'scanning');
  let done = 0, total = 0;
  for (const p of active) if (p.phase !== 'discovering' && p.total > 0) { done += p.done; total += p.total; }
  const ratio = total > 0 ? Math.min(1, done / total) : undefined;

  const stats = useMemo(() => { let geo = 0; for (const p of photos) if (p.lat != null) geo++; return { geo }; }, [photos]);
  const recent = useMemo(() => photos.slice(-8).reverse(), [photos]);
  const empty = !scanning && photos.length === 0;

  const finish = async (view: 'map' | 'photos') => { setView(view); await setSettings({ onboardingDone: true }); };
  const canMap = stats.geo > 0;

  return (
    <>
      <Logo size={40} />
      <h1 className="onb__title"><span>{empty ? t('onboarding.empty.title') : scanning ? t('onboarding.scan.title') : t('onboarding.ready.title')}</span></h1>
      <p className="onb__lead">{empty ? t('onboarding.empty.lead') : scanning ? t('onboarding.scan.lead') : t('onboarding.ready.lead')}</p>

      {!empty && (
        <div className="onb__progress" role="status" aria-live="polite">
          <div className="onb__found tabular">{t('onboarding.found', { photos: tn('onboarding.found.photos', photos.length), geo: fmtNumber(stats.geo) })}</div>
          {scanning && <ProgressBar value={ratio} label={t('sync.scanning')} />}
          {scanning && <div className="onb__phase tabular">{active[0] ? phaseLabel(active[0]) : t('sync.scanning')}{ratio != null ? ` · ${Math.round(ratio * 100)} %` : ''}</div>}
          {recent.length > 0 && (
            <div className="onb__thumbs" aria-hidden>{recent.map((p) => <img key={p.id} src={thumbUrl(p, 256)} alt="" style={{ background: p.color }} draggable={false} />)}</div>
          )}
        </div>
      )}

      <div className="onb__cta">
        {empty ? (
          <>
            <Button variant="primary" size="lg" icon={<FolderOpen size={18} />} onClick={() => { void pickFolders(); }}>{t('onboarding.pick')}</Button>
            <Button variant="ghost" size="lg" onClick={() => finish('photos')}>{t('onboarding.openAnyway')}</Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" icon={canMap ? <MapIcon size={18} /> : undefined} disabled={!canMap && photos.length === 0 ? true : false} onClick={() => finish(canMap ? 'map' : 'photos')}>
              {canMap ? t('onboarding.openMap') : t('onboarding.openLibrary')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => { void pickFolders(); }}>{t('onboarding.addMore')}</Button>
          </>
        )}
      </div>
      {scanning && !canMap && <div className="onb__note">{t('onboarding.waitGeo')}</div>}
    </>
  );
}
