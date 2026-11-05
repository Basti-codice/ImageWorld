import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CircleCheck, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useT, tn } from '@/i18n';
import { fmtNumber } from '@/lib/format';
import { Button, Popover, ProgressBar, ProgressRing } from '@/ui';
import { SourceIcon, phaseLabel, progressRatio, relativeTime } from './sources';

type Mode = 'scanning' | 'idle' | 'offline' | 'error';

/** Sync pill in the titlebar: aggregate state + popover with per-source details. */
export default function SyncStatus() {
  const t = useT();
  const sources = useLibrary((s) => s.sources);
  const progress = useLibrary((s) => s.progress);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const agg = useMemo(() => {
    const active = Object.values(progress).filter((p) => p.phase !== 'done');
    const scanning = active.length > 0 || sources.some((s) => s.status === 'scanning');
    let done = 0, total = 0;
    for (const p of active) if (p.phase !== 'discovering' && p.total > 0) { done += p.done; total += p.total; }
    const ratio = total > 0 ? Math.min(1, done / total) : undefined;
    const mode: Mode = scanning ? 'scanning' : sources.some((s) => s.status === 'error') ? 'error' : sources.some((s) => s.status === 'offline') ? 'offline' : 'idle';
    return { mode, ratio, done, total };
  }, [progress, sources]);

  if (!sources.length) return null;
  const { mode, ratio } = agg;
  const pct = ratio != null ? Math.round(ratio * 100) : null;
  const label = mode === 'scanning' ? (pct != null ? t('sync.pill.scanningPct', { pct }) : t('sync.scanning')) : mode === 'idle' ? t('sync.idle') : mode === 'offline' ? t('sync.pill.offline') : t('sync.error');

  return (
    <>
      <button
        ref={btn} type="button" className={clsx('sync', `sync--${mode}`)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${t('sync.title')}: ${label}`} onClick={() => setOpen((o) => !o)}
      >
        <span className="sync__icon">
          {mode === 'scanning' ? <ProgressRing size={16} stroke={2.25} value={ratio} />
            : mode === 'idle' ? <CircleCheck size={15} strokeWidth={2} />
            : mode === 'offline' ? <WifiOff size={15} strokeWidth={2} /> : <TriangleAlert size={15} strokeWidth={2} />}
        </span>
        <span className="sync__label tabular">{label}</span>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} align="end" width={360} label={t('sync.title')} className="syncpop">
        <div className="syncpop__head">
          <div>
            <div className="syncpop__title">{t('sync.title')}</div>
            <div className="syncpop__sub tabular">
              {mode === 'scanning' ? (agg.total > 0 ? `${fmtNumber(agg.done)} / ${fmtNumber(agg.total)}` : t('sync.scanning')) : mode === 'idle' ? t('sync.allCurrent') : mode === 'offline' ? t('sync.someOffline') : t('sync.someError')}
            </div>
          </div>
          {mode === 'scanning' && <ProgressRing size={28} stroke={3} value={ratio}>{pct != null ? pct : undefined}</ProgressRing>}
        </div>
        <ul className="syncpop__list">
          {sources.map((s) => {
            const p = progress[s.id];
            const scanning = !!p && p.phase !== 'done' || s.status === 'scanning';
            const r = progressRatio(p);
            return (
              <li key={s.id} className={clsx('syncrow', s.status === 'offline' && 'syncrow--warn', s.status === 'error' && 'syncrow--err')}>
                <span className="syncrow__icon"><SourceIcon kind={s.kind} /></span>
                <div className="syncrow__main">
                  <div className="syncrow__top"><span className="truncate syncrow__name">{s.label}</span><span className="syncrow__count tabular">{fmtNumber(s.photoCount)}</span></div>
                  <div className="syncrow__meta truncate">
                    {scanning ? (p ? `${phaseLabel(p)}${p.total > 0 && p.phase !== 'discovering' ? ` · ${fmtNumber(p.done)} / ${fmtNumber(p.total)}` : ''}` : t('sync.scanning'))
                      : s.status === 'offline' ? t('sync.offline') : s.status === 'error' ? (s.error ?? t('sync.error'))
                      : s.lastScan ? t('sync.lastScan', { when: relativeTime(s.lastScan) }) : t('sync.idle')}
                  </div>
                  {scanning && <ProgressBar value={r} className="syncrow__bar" label={s.label} />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="syncpop__foot">
          <span className="syncpop__total">{tn('common.photos', sources.reduce((a, s) => a + s.photoCount, 0))}</span>
          <Button size="sm" icon={<RefreshCw size={14} />} disabled={mode === 'scanning'} onClick={() => { window.api.sources.rescan(); }}>{t('sync.rescanAll')}</Button>
        </div>
      </Popover>
    </>
  );
}
