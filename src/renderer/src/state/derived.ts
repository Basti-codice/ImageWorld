import { create } from 'zustand';
import type { Photo } from '@shared/types';
import { applyFilters } from '@/lib/filter';
import { useLibrary } from './library';
import { useUi } from './ui';

interface Derived {
  /** all filters applied, sorted by sortTime DESC (newest first) */
  filtered: Photo[];
  /** all filters except the timeline range – feeds the timeline histogram so it doesn't collapse when brushing */
  filteredNoRange: Photo[];
  /** `filtered` restricted to photos with coordinates – feeds the map */
  geo: Photo[];
}

const byTimeDesc = (a: Photo, b: Photo) => b.sortTime - a.sortTime || (a.name < b.name ? -1 : 1);

export const useDerived = create<Derived>(() => ({ filtered: [], filteredNoRange: [], geo: [] }));

function recompute() {
  const { photos } = useLibrary.getState();
  const { filters } = useUi.getState();
  const filteredNoRange = applyFilters(photos, filters, { ignoreRange: true }).sort(byTimeDesc);
  const range = filters.range;
  const filtered = range ? filteredNoRange.filter((p) => p.sortTime >= range[0] && p.sortTime <= range[1]) : filteredNoRange;
  useDerived.setState({ filtered, filteredNoRange, geo: filtered.filter((p) => p.lat != null && p.lon != null) });
}

let queued = false;
const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; recompute(); }); };
useLibrary.subscribe((s, p) => { if (s.photos !== p.photos) schedule(); });
useUi.subscribe((s, p) => { if (s.filters !== p.filters) schedule(); });
recompute();
