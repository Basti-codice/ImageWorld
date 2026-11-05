import { create } from 'zustand';
import type { AreaSelection } from '@shared/types';
import { EMPTY_FILTERS, type Filters } from '@/lib/filter';

export type View = 'map' | 'photos' | 'albums' | 'places' | 'insights';

export interface Toast { id: number; message: string; tone?: 'info' | 'success' | 'danger'; action?: { label: string; run: () => void } }

interface UiState {
  view: View;
  setView(v: View): void;
  /** currently opened album (albums view shows detail when set) */
  albumId: string | null;
  openAlbum(id: string | null): void;

  filters: Filters;
  setFilters(patch: Partial<Filters>): void;
  resetFilters(): void;

  /** multi-selection of photo ids (grid + map) */
  selection: Set<string>;
  select(ids: Iterable<string>, mode?: 'replace' | 'add' | 'toggle'): void;
  clearSelection(): void;

  /** lightbox/viewer: ordered list of ids that can be paged through + current index */
  viewer: { ids: string[]; index: number } | null;
  openViewer(ids: string[], index: number): void;
  closeViewer(): void;
  setViewerIndex(i: number): void;

  /** photo currently hovered anywhere (grid <-> map highlight) */
  hoverId: string | null;
  setHoverId(id: string | null): void;

  /** area being drawn/selected on the map (before it becomes a filter / album) */
  draftArea: AreaSelection | null;
  setDraftArea(a: AreaSelection | null): void;

  /** map viewport (for "photos in view" strip), [w,s,e,n] */
  mapBounds: [number, number, number, number] | null;
  setMapBounds(b: [number, number, number, number] | null): void;
  /** imperative request to fly the map somewhere (consumed by MapView) */
  flyTo: { bbox?: [number, number, number, number]; center?: [number, number]; zoom?: number; nonce: number } | null;
  requestFlyTo(t: Omit<NonNullable<UiState['flyTo']>, 'nonce'>): void;

  commandPaletteOpen: boolean;
  setCommandPalette(o: boolean): void;
  settingsOpen: boolean;
  setSettingsOpen(o: boolean): void;
  /** dialog to create an album from the current selection / area */
  createAlbumOpen: boolean;
  setCreateAlbumOpen(o: boolean): void;

  toasts: Toast[];
  toast(message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>): void;
  dismissToast(id: number): void;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  view: 'map', setView: (view) => set({ view, albumId: view === 'albums' ? get().albumId : null }),
  albumId: null, openAlbum: (albumId) => set({ albumId, view: 'albums' }),

  filters: EMPTY_FILTERS,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),

  selection: new Set(),
  select: (ids, mode = 'replace') => set((s) => {
    const next = mode === 'replace' ? new Set<string>() : new Set(s.selection);
    for (const id of ids) { if (mode === 'toggle' && next.has(id)) next.delete(id); else next.add(id); }
    return { selection: next };
  }),
  clearSelection: () => set({ selection: new Set() }),

  viewer: null,
  openViewer: (ids, index) => set({ viewer: { ids, index } }),
  closeViewer: () => set({ viewer: null }),
  setViewerIndex: (index) => set((s) => (s.viewer ? { viewer: { ...s.viewer, index } } : {})),

  hoverId: null, setHoverId: (hoverId) => set({ hoverId }),

  draftArea: null, setDraftArea: (draftArea) => set({ draftArea }),
  mapBounds: null, setMapBounds: (mapBounds) => set({ mapBounds }),
  flyTo: null, requestFlyTo: (t) => set({ flyTo: { ...t, nonce: Date.now() } }),

  commandPaletteOpen: false, setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
  settingsOpen: false, setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  createAlbumOpen: false, setCreateAlbumOpen: (createAlbumOpen) => set({ createAlbumOpen }),

  toasts: [],
  toast: (message, opts = {}) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, ...opts }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
