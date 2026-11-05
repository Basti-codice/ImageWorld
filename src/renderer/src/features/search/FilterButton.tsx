import { SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { useSearchUi } from './store';
import { popoverFilterCount } from './FilterPopover';

/** Opens the filter popover (mounted once inside SearchBox). `compact` renders an icon-only button. */
export default function FilterButton({ compact }: { compact?: boolean }) {
  const t = useT();
  const filters = useUi((s) => s.filters);
  const open = useSearchUi((s) => s.filterOpen);
  const n = popoverFilterCount(filters);
  return (
    <button
      type="button" data-filter-anchor className={clsx(compact ? 'ibtn ibtn--sm' : 'chip pv__chip', open && 'ibtn--active')} aria-pressed={open || n > 0} aria-haspopup="dialog" aria-expanded={open}
      aria-label={t('search.filters.title')} title={t('search.filters.title')}
      onClick={(e) => { e.stopPropagation(); useSearchUi.getState().toggleFilters(e.currentTarget); }}
    >
      <SlidersHorizontal size={14} />
      {!compact && t('search.filters.title')}
      {n > 0 && <span className="pv__badge tabular">{n}</span>}
    </button>
  );
}
