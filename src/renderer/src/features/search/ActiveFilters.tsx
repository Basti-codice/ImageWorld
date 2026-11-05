import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Clock, Film, Heart, Image as ImageIcon, MapPin, MapPinOff, Search, Star, Tag, X, Camera, Aperture, Globe2, FolderOpen, MapPinned, Frame } from 'lucide-react';
import { Button } from '@/ui';
import { tn, useT, useLang } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useDerived } from '@/state/derived';
import { activeFilterCount, splitCityKey, type Filters } from '@/lib/filter';
import { fmtDate } from '@/lib/format';
import { countryName } from '@/lib/countries';
import './search.css';

interface ChipDef { key: string; label?: string; value: string; icon: ReactNode; remove(): void }

const DAY = 864e5;
/** "2024", "Mai 2024", "3. Mai 2024" or "3. Mai – 9. Juni 2024" for a [from,to] range (UTC "local-as-UTC" times). */
export function formatRange(from: number, to: number): string {
  const a = new Date(from), b = new Date(to);
  const startsYear = a.getUTCMonth() === 0 && a.getUTCDate() === 1;
  const endsYear = b.getUTCMonth() === 11 && b.getUTCDate() === 31;
  if (startsYear && endsYear && a.getUTCFullYear() === b.getUTCFullYear()) return String(a.getUTCFullYear());
  const startsMonth = a.getUTCDate() === 1;
  const endsMonth = new Date(to + DAY).getUTCDate() === 1;
  if (startsMonth && endsMonth && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return fmtDate(from, { month: 'long', year: 'numeric' });
  const sameDay = Math.floor(from / DAY) === Math.floor(to / DAY);
  if (sameDay) return fmtDate(from);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${fmtDate(from, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function useChips(f: Filters): ChipDef[] {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const sources = useLibrary((s) => s.sources);
  const set = useUi((s) => s.setFilters);
  const sourceLabel = (id: string) => sources.find((s) => s.id === id)?.label ?? id;
  return useMemo(() => {
    const out: ChipDef[] = [];
    const q = f.query.trim();
    if (q) out.push({ key: 'q', value: lang === 'de' ? `„${q}“` : `“${q}”`, icon: <Search size={13} />, remove: () => set({ query: '' }) });
    if (f.range) out.push({ key: 'range', label: t('search.chip.range'), value: formatRange(f.range[0], f.range[1]), icon: <Clock size={13} />, remove: () => set({ range: null }) });
    if (f.area) {
      const w = f.area.from != null && f.area.to != null ? formatRange(f.area.from, f.area.to) : '';
      out.push({ key: 'area', value: t('search.chip.area') + (w ? ` · ${w}` : ''), icon: <Frame size={13} />, remove: () => set({ area: null }) });
    }
    f.cities?.forEach((k) => out.push({ key: `city:${k}`, value: splitCityKey(k).city, icon: <MapPin size={13} />, remove: () => set({ cities: f.cities.filter((x) => x !== k) }) }));
    f.countries.forEach((cc) => out.push({ key: `cc:${cc}`, value: countryName(cc, lang), icon: <Globe2 size={13} />, remove: () => set({ countries: f.countries.filter((x) => x !== cc) }) }));
    f.kinds.forEach((k) => out.push({ key: `kind:${k}`, value: t(k === 'photo' ? 'search.filters.photos' : 'search.filters.videos'), icon: k === 'photo' ? <ImageIcon size={13} /> : <Film size={13} />, remove: () => set({ kinds: f.kinds.filter((x) => x !== k) }) }));
    if (f.favoritesOnly) out.push({ key: 'fav', value: t('search.filters.favorites'), icon: <Heart size={13} />, remove: () => set({ favoritesOnly: false }) });
    if (f.location !== 'any') out.push({ key: 'loc', value: t(f.location === 'with' ? 'search.filters.loc.with' : 'search.filters.loc.without'), icon: f.location === 'with' ? <MapPinned size={13} /> : <MapPinOff size={13} />, remove: () => set({ location: 'any' }) });
    f.cameras.forEach((c) => out.push({ key: `cam:${c}`, value: c, icon: <Camera size={13} />, remove: () => set({ cameras: f.cameras.filter((x) => x !== c) }) }));
    f.lenses?.forEach((c) => out.push({ key: `lens:${c}`, value: c, icon: <Aperture size={13} />, remove: () => set({ lenses: f.lenses.filter((x) => x !== c) }) }));
    if (f.minRating > 0) out.push({ key: 'rating', value: t('search.chip.rating', { n: f.minRating }), icon: <Star size={13} />, remove: () => set({ minRating: 0 }) });
    f.tags.forEach((g) => out.push({ key: `tag:${g}`, value: g, icon: <Tag size={13} />, remove: () => set({ tags: f.tags.filter((x) => x !== g) }) }));
    f.sourceIds.forEach((s) => out.push({ key: `src:${s}`, value: sourceLabel(s), icon: <FolderOpen size={13} />, remove: () => set({ sourceIds: f.sourceIds.filter((x) => x !== s) }) }));
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, t, lang, sources, set]);
}

/** Slim row of removable chips for every active filter. Slides in/out; renders null when nothing is active. */
export default function ActiveFilters() {
  const t = useT();
  const filters = useUi((s) => s.filters);
  const n = useDerived((s) => s.filtered.length);
  const active = activeFilterCount(filters) > 0;
  const [mounted, setMounted] = useState(active);
  const [open, setOpen] = useState(active);
  const last = useRef(filters);
  if (active) last.current = filters;
  const chips = useChips(active ? filters : last.current);

  useEffect(() => {
    if (active) {
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setOpen(true)); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    setOpen(false);
    const tm = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(tm);
  }, [active]);

  if (!mounted) return null;
  return (
    <div className="af" data-open={open || undefined} role="region" aria-label={t('search.chip.region')}>
      <div className="af__in">
        <div className="af__row">
          <div className="af__chips">
            {chips.map((c) => (
              <span key={c.key} className="af-chip">
                {c.icon}
                {c.label && <span className="af-chip__label">{c.label}</span>}
                <span className="af-chip__value truncate">{c.value}</span>
                <button className="af-chip__x" onClick={c.remove} aria-label={t('search.chip.remove', { name: c.value })} title={t('search.chip.remove', { name: c.value })}><X size={12} strokeWidth={2.4} /></button>
              </span>
            ))}
            {chips.length > 1 && <Button variant="ghost" size="sm" className="af__reset" onClick={() => useUi.getState().resetFilters()}>{t('search.chip.resetAll')}</Button>}
          </div>
          <span className="af__count tabular">{tn('search.results', n)}</span>
        </div>
      </div>
    </div>
  );
}
