import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@/i18n';
import { useLibrary } from '@/state/library';
import './viewer.css';

/** Library-wide tags ordered by usage – shared suggestion source. */
export function useTagSuggestions(): string[] {
  const photos = useLibrary((s) => s.photos);
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) for (const tag of p.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
  }, [photos]);
}

export const normTag = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40);

interface Props { tags: string[]; onAdd(tag: string): void; onRemove(tag: string): void; autoFocus?: boolean }

/** Chips + inline input; Enter/comma adds, Backspace on empty input removes the last chip. Suggestions are clickable chips. */
export default function TagEditor({ tags, onAdd, onRemove, autoFocus }: Props) {
  const t = useT();
  const all = useTagSuggestions();
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const have = useMemo(() => new Set(tags.map((x) => x.toLowerCase())), [tags]);
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return all.filter((x) => !have.has(x.toLowerCase()) && (!q || x.toLowerCase().includes(q))).slice(0, 8);
  }, [all, have, draft]);

  const commit = (raw: string) => {
    const tag = normTag(raw);
    setDraft('');
    if (!tag || have.has(tag.toLowerCase())) return;
    onAdd(all.find((x) => x.toLowerCase() === tag.toLowerCase()) ?? tag);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // viewer shortcuts must not fire while typing
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(draft); }
    else if (e.key === 'Backspace' && !draft && tags.length) onRemove(tags[tags.length - 1]);
    else if (e.key === 'Escape') { if (draft) { setDraft(''); e.nativeEvent.stopImmediatePropagation(); } e.currentTarget.blur(); }
  };

  return (
    <div className="tags">
      <div className="tags__box" onClick={() => ref.current?.focus()}>
        {tags.map((tag) => (
          <span key={tag} className="tagchip">{tag}<button aria-label={t('viewer.tags.remove', { tag })} onClick={(e) => { e.stopPropagation(); onRemove(tag); }}><X size={11} strokeWidth={2.5} /></button></span>
        ))}
        <input ref={ref} value={draft} autoFocus={autoFocus} maxLength={40} placeholder={tags.length ? '' : t('viewer.tags.add')} aria-label={t('viewer.tags.add')}
          onChange={(e) => setDraft(e.target.value.replace(',', ''))} onKeyDown={onKey} onBlur={() => draft && commit(draft)} />
      </div>
      {suggestions.length > 0 && (
        <div className="tags__sugg" aria-label={t('viewer.tags.suggestions')}>
          {suggestions.map((s) => <button key={s} className="tagsugg" onClick={() => commit(s)}><Plus size={11} strokeWidth={2.5} />{s}</button>)}
        </div>
      )}
    </div>
  );
}
