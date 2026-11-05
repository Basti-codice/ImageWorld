import { useEffect } from 'react';
import { Search, X } from 'lucide-react';
import clsx from 'clsx';
import { IconButton, Kbd } from '@/ui';
import { useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { warmTextIndex } from '@/lib/filter';
import FilterButton from './FilterButton';
import FilterPopover from './FilterPopover';
import './search.css';

/** Titlebar search field: a pill that opens the command palette; shows the active free-text query with a clear button. */
export default function SearchBox() {
  const t = useT();
  const query = useUi((s) => s.filters.query);
  const open = useUi((s) => s.commandPaletteOpen);
  const setOpen = useUi((s) => s.setCommandPalette);

  // build the search index in idle time (first query on 100k photos stays instant)
  const photos = useLibrary((s) => s.photos);
  useEffect(() => { warmTextIndex(photos); }, [photos]);

  // "/" opens the palette like in most web apps (not while typing somewhere)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      e.preventDefault(); setOpen(true);
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, [setOpen]);

  return (
    <div className={clsx('sb', open && 'is-open', query && 'has-query')} role="search">
      <button type="button" className="sb__main" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t('search.placeholder')}>
        <Search size={15} strokeWidth={2} />
        {query ? <span className="sb__query truncate">{query}</span> : <span className="sb__ph truncate">{t('search.placeholder')}</span>}
      </button>
      {query
        ? <IconButton label={t('search.clear')} size="sm" onClick={() => useUi.getState().setFilters({ query: '' })}><X size={14} /></IconButton>
        : <Kbd>{t('search.hint')}</Kbd>}
      <span className="sb__sep" />
      <FilterButton compact />
      <FilterPopover />
    </div>
  );
}
