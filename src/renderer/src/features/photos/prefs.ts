import { create } from 'zustand';

export type Density = 's' | 'm' | 'l';
export type SortDir = 'desc' | 'asc';
export type GroupBy = 'day' | 'month';

interface Prefs {
  density: Density;
  sort: SortDir;
  groupBy: GroupBy;
  set(patch: Partial<Omit<Prefs, 'set'>>): void;
}

const KEY = 'iw.photos.prefs';
const defaults = { density: 'm' as Density, sort: 'desc' as SortDir, groupBy: 'day' as GroupBy };

function load(): typeof defaults {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      density: ['s', 'm', 'l'].includes(raw.density) ? raw.density : defaults.density,
      sort: raw.sort === 'asc' ? 'asc' : 'desc',
      groupBy: raw.groupBy === 'month' ? 'month' : 'day',
    };
  } catch { return defaults; }
}

/** Grid preferences shared by the Mediathek and album grids; persisted in localStorage. */
export const usePhotoPrefs = create<Prefs>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { density, sort, groupBy } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ density, sort, groupBy })); } catch { /* storage unavailable */ }
  },
}));

export const ROW_HEIGHT: Record<Density, number> = { s: 120, m: 184, l: 268 };
export const GAP: Record<Density, number> = { s: 2, m: 4, l: 4 };
