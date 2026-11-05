import { useCallback, useMemo, useState } from 'react';
import { ArrowDownUp, Check, FolderPlus, ImageOff, MapPinOff, SearchX } from 'lucide-react';
import { Button, EmptyState, Menu, Segmented, type MenuItem } from '@/ui';
import { tn, useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { useDerived } from '@/state/derived';
import { activeFilterCount } from '@/lib/filter';
import { fmtNumber } from '@/lib/format';
import FilterButton from '@/features/search/FilterButton';
import { PhotoGrid } from './PhotoGrid';
import { usePhotoPrefs, type Density } from './prefs';
import './photos.css';

/** The "Mediathek": every photo matching the current filters, in a justified, day-grouped, virtualised grid. */
export default function PhotosView() {
  const t = useT();
  const filtered = useDerived((s) => s.filtered);
  const filters = useUi((s) => s.filters);
  const loaded = useLibrary((s) => s.loaded);
  const total = useLibrary((s) => s.photos.length);
  const scanning = useLibrary((s) => Object.keys(s.progress).length > 0);
  const { sort, density, groupBy, set } = usePhotoPrefs();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const list = useMemo(() => (sort === 'asc' ? [...filtered].reverse() : filtered), [filtered, sort]);
  const videos = useMemo(() => { let n = 0; for (const p of filtered) if (p.kind === 'video') n++; return n; }, [filtered]);
  const filterActive = activeFilterCount(filters) > 0;
  const noLoc = filters.location === 'without';
  const loading = !loaded || (total === 0 && scanning);

  const sortMenu = useMemo<MenuItem[]>(() => {
    const mark = (on: boolean) => (on ? <Check size={16} /> : <span style={{ width: 16 }} />);
    return [
      { label: t('photos.sort.desc'), icon: mark(sort === 'desc'), onSelect: () => set({ sort: 'desc' }) },
      { label: t('photos.sort.asc'), icon: mark(sort === 'asc'), onSelect: () => set({ sort: 'asc' }) },
      { label: t('photos.group.day'), icon: mark(groupBy === 'day'), onSelect: () => set({ groupBy: 'day' }), separatorBefore: true },
      { label: t('photos.group.month'), icon: mark(groupBy === 'month'), onSelect: () => set({ groupBy: 'month' }) },
    ];
  }, [t, sort, groupBy, set]);
  const closeMenu = useCallback(() => setMenu(null), []);

  const empty = total === 0
    ? <EmptyState icon={<ImageOff size={40} strokeWidth={1.25} />} title={t('photos.empty.library.title')} hint={t('photos.empty.library.hint')}
        action={<Button variant="primary" icon={<FolderPlus size={16} />} onClick={() => { void window.api.sources.pickAndAdd(); }}>{t('photos.empty.library.add')}</Button>} />
    : <EmptyState icon={<SearchX size={40} strokeWidth={1.25} />} title={t('photos.empty.filtered.title')} hint={t('photos.empty.filtered.hint')}
        action={filterActive ? <Button variant="primary" onClick={() => useUi.getState().resetFilters()}>{t('photos.empty.filtered.reset')}</Button> : undefined} />;

  return (
    <section className="pv" aria-label={t('photos.title')}>
      <header className="pv__bar">
        <div className="pv__title">
          <h1>{t('photos.title')}</h1>
          <span className="pv__count tabular">
            {filterActive && total !== filtered.length ? t('photos.count.of', { n: fmtNumber(filtered.length), total: fmtNumber(total) }) : tn('common.photos', filtered.length)}
            {videos > 0 ? ` · ${tn('photos.count.videos', videos)}` : ''}
          </span>
        </div>
        <button className="chip pv__chip" aria-pressed={noLoc} onClick={() => useUi.getState().setFilters({ location: noLoc ? 'any' : 'without' })}>
          <MapPinOff size={14} />{t('photos.noLocation')}
        </button>
        <FilterButton />
        <Button variant="ghost" size="sm" icon={<ArrowDownUp size={14} />} aria-haspopup="menu" aria-label={t('photos.sort')}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 200, y: r.bottom + 6 }); }}>
          {sort === 'desc' ? t('photos.sort.desc') : t('photos.sort.asc')}
        </Button>
        <Segmented<Density> value={density} onChange={(v) => set({ density: v })}
          options={[{ value: 's', label: 'S', title: t('photos.density.s') }, { value: 'm', label: 'M', title: t('photos.density.m') }, { value: 'l', label: 'L', title: t('photos.density.l') }]} />
      </header>
      <div className="pv__body">
        <PhotoGrid photos={list} loading={loading} emptyState={empty} scrollKey="photos" />
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={sortMenu} onClose={closeMenu} />}
    </section>
  );
}
