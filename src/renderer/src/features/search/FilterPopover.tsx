import { forwardRef, memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Heart, Star, Video, Image as ImageIcon, X } from 'lucide-react';
import clsx from 'clsx';
import type { MediaKind } from '@shared/types';
import { Button, IconButton, Segmented, Switch } from '@/ui';
import { tn, useT, useLang } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { facetCounts, type Filters, type FacetCounts } from '@/lib/filter';
import { fmtNumber } from '@/lib/format';
import { countryName } from '@/lib/countries';
import { useSearchUi } from './store';
import { getIndex } from './searchIndex';

/** number of active filters that this popover edits (query/range/area have their own chips) */
export function popoverFilterCount(f: Filters): number {
  return (f.kinds.length ? 1 : 0) + (f.favoritesOnly ? 1 : 0) + (f.location !== 'any' ? 1 : 0) + (f.cameras.length ? 1 : 0) + (f.lenses?.length ? 1 : 0)
    + (f.countries.length ? 1 : 0) + (f.sourceIds.length ? 1 : 0) + (f.minRating > 0 ? 1 : 0) + (f.tags.length ? 1 : 0);
}

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function Section({ title, hint, children, defaultOpen = true }: { title: string; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fp-sec">
      <button className="fp-sec__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>{hint != null && <span className="fp-sec__hint">{hint}</span>}
        <ChevronDown size={14} className={clsx('fp-sec__chev', !open && 'is-closed')} />
      </button>
      {open && <div className="fp-sec__body">{children}</div>}
    </section>
  );
}

interface Opt { value: string; label: string; count: number }

/** checkbox list with live counts; shows the top entries, expandable */
const OptionList = memo(function OptionList({ options, selected, onToggle, limit = 5 }: { options: Opt[]; selected: string[]; onToggle(v: string): void; limit?: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const visible = options.filter((o) => o.count > 0 || selected.includes(o.value));
  const shown = (() => {
    const filtered = q ? visible.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : visible;
    if (all || q) return filtered;
    const top = filtered.slice(0, limit);
    for (const o of filtered) if (selected.includes(o.value) && !top.includes(o)) top.push(o);
    return top;
  })();
  if (!visible.length) return <div className="fp-none">{t('search.filters.none')}</div>;
  return (
    <div>
      {all && visible.length > 10 && <input className="field fp-q" placeholder={t('search.filters.find')} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className={clsx('fp-opts', all && 'fp-opts--scroll')} role="group">
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button key={o.value} className="fp-opt" role="checkbox" aria-checked={on} onClick={() => onToggle(o.value)}>
              <span className="fp-opt__box" data-on={on || undefined}><Check size={11} strokeWidth={3.2} /></span>
              <span className="fp-opt__label truncate">{o.label}</span>
              <span className="fp-opt__n tabular">{fmtNumber(o.count)}</span>
            </button>
          );
        })}
        {!shown.length && <div className="fp-none">{t('search.filters.none')}</div>}
      </div>
      {visible.length > limit && !q && <button className="fp-more" onClick={() => setAll(!all)}>{all ? t('search.filters.less') : t('search.filters.more', { n: visible.length - limit })}</button>}
    </div>
  );
});

export default function FilterPopover() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const open = useSearchUi((s) => s.filterOpen);
  const anchor = useSearchUi((s) => s.anchor);
  const close = useSearchUi((s) => s.closeFilters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current?.contains(el) || el.closest?.('[data-filter-anchor]') || el.closest?.('.menu')) return;
      close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('mousedown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); };
  }, [open, close]);

  if (!open) return null;
  return createPortal(<Panel ref={ref} anchor={anchor} lang={lang} t={t} onClose={close} />, document.body);
}

type TFn = ReturnType<typeof useT>;

const Panel = forwardRef<HTMLDivElement, { anchor: { right: number; bottom: number } | null; lang: string; t: TFn; onClose(): void }>(function Panel({ anchor, lang, t, onClose }, ref) {
  const photos = useLibrary((s) => s.photos);
  const sources = useLibrary((s) => s.sources);
  const filters = useUi((s) => s.filters);
  const setFilters = useUi((s) => s.setFilters);
  const deferred = useDeferredValue(filters);
  const index = useMemo(() => getIndex(photos), [photos]);
  const counts: FacetCounts = useMemo(() => facetCounts(photos, deferred), [photos, deferred]);
  const stale = deferred !== filters;

  const style = anchor
    ? { top: anchor.bottom + 8, right: Math.max(12, innerWidth - anchor.right) }
    : { top: 52, left: '50%', transform: 'translateX(-50%)' };

  const cams: Opt[] = index.cameras.map((c) => ({ value: c.name, label: c.name, count: counts.cameras.get(c.name) ?? 0 }));
  const lenses: Opt[] = index.lenses.map((c) => ({ value: c.name, label: c.name, count: counts.lenses.get(c.name) ?? 0 }));
  const countries: Opt[] = index.countries.map((c) => ({ value: c.cc, label: countryName(c.cc, lang, c.name), count: counts.countries.get(c.cc) ?? 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const tagOpts: Opt[] = index.tags.map((c) => ({ value: c.name, label: c.name, count: counts.tags.get(c.name) ?? 0 })).sort((a, b) => b.count - a.count);
  const srcOpts: Opt[] = sources.map((s) => ({ value: s.id, label: s.label, count: counts.sources.get(s.id) ?? 0 }));
  const sortByCount = (o: Opt[]) => [...o].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const kindChip = (k: MediaKind, label: string, icon: ReactNode) => {
    const on = filters.kinds.includes(k);
    return (
      <button className="chip fp-kind" aria-pressed={on} onClick={() => setFilters({ kinds: toggle(filters.kinds, k) })}>
        {icon}{label}<span className="fp-kind__n tabular">{fmtNumber(counts.kinds[k])}</span>
      </button>
    );
  };
  const active = popoverFilterCount(filters);
  const reset = () => setFilters({ kinds: [], favoritesOnly: false, location: 'any', cameras: [], lenses: [], countries: [], sourceIds: [], minRating: 0, tags: [] });

  return (
    <div ref={ref} className="fp" style={style} role="dialog" aria-label={t('search.filters.title')}>
      <header className="fp__head">
        <h3>{t('search.filters.title')}</h3>
        {active > 0 && <Button variant="ghost" size="sm" onClick={reset}>{t('search.filters.reset')}</Button>}
        <IconButton label={t('common.close')} size="sm" onClick={onClose}><X size={14} /></IconButton>
      </header>
      <div className="fp__scroll">
        <Section title={t('search.filters.type')}>
          <div className="fp-chips">{kindChip('photo', t('search.filters.photos'), <ImageIcon size={14} />)}{kindChip('video', t('search.filters.videos'), <Video size={14} />)}</div>
        </Section>
        <div className="fp-row">
          <span className="fp-row__label"><Heart size={14} />{t('search.filters.favorites')}<span className="fp-row__n tabular">{fmtNumber(counts.favorites)}</span></span>
          <Switch checked={filters.favoritesOnly} onChange={(v) => setFilters({ favoritesOnly: v })} label={t('search.filters.favorites')} />
        </div>
        <Section title={t('search.filters.location')}>
          <Segmented value={filters.location} onChange={(v) => setFilters({ location: v })} options={[
            { value: 'any', label: t('search.filters.loc.any') },
            { value: 'with', label: <>{t('search.filters.loc.with')}<span className="fp-seg-n tabular">{fmtNumber(counts.location.with)}</span></> },
            { value: 'without', label: <>{t('search.filters.loc.without')}<span className="fp-seg-n tabular">{fmtNumber(counts.location.without)}</span></> },
          ]} />
        </Section>
        <Section title={t('search.filters.rating')} hint={filters.minRating > 0 ? t('search.filters.ratingMin', { n: filters.minRating }) : undefined}>
          <div className="fp-stars" role="radiogroup" aria-label={t('search.filters.rating')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={filters.minRating === n} className={clsx('fp-star', filters.minRating >= n && 'is-on')} title={`${n}+ · ${fmtNumber(counts.rating[n])}`}
                onClick={() => setFilters({ minRating: filters.minRating === n ? 0 : n })}><Star size={18} fill={filters.minRating >= n ? 'currentColor' : 'none'} /></button>
            ))}
            {filters.minRating > 0 && <span className="fp-stars__n tabular">{tn('common.photos', counts.rating[filters.minRating] ?? 0)}</span>}
          </div>
        </Section>
        {cams.length > 0 && <Section title={t('search.filters.camera')} hint={filters.cameras.length || undefined}><OptionList options={sortByCount(cams)} selected={filters.cameras} onToggle={(v) => setFilters({ cameras: toggle(filters.cameras, v) })} /></Section>}
        {lenses.length > 0 && <Section title={t('search.filters.lens')} hint={filters.lenses.length || undefined} defaultOpen={filters.lenses.length > 0}><OptionList options={sortByCount(lenses)} selected={filters.lenses} onToggle={(v) => setFilters({ lenses: toggle(filters.lenses, v) })} /></Section>}
        {countries.length > 0 && <Section title={t('search.filters.country')} hint={filters.countries.length || undefined}><OptionList options={countries} selected={filters.countries} onToggle={(v) => setFilters({ countries: toggle(filters.countries, v) })} /></Section>}
        {tagOpts.length > 0 && <Section title={t('search.filters.tags')} hint={filters.tags.length || undefined}><OptionList options={tagOpts} selected={filters.tags} onToggle={(v) => setFilters({ tags: toggle(filters.tags, v) })} limit={8} /></Section>}
        {srcOpts.length > 1 && <Section title={t('search.filters.source')} hint={filters.sourceIds.length || undefined}><OptionList options={sortByCount(srcOpts)} selected={filters.sourceIds} onToggle={(v) => setFilters({ sourceIds: toggle(filters.sourceIds, v) })} /></Section>}
      </div>
      <footer className="fp__foot">
        <span className={clsx('tabular', stale && 'is-stale')}>{tn('common.photos', counts.total)}</span>
        <Button variant="primary" size="sm" onClick={onClose}>{t('common.done')}</Button>
      </footer>
    </div>
  );
});
