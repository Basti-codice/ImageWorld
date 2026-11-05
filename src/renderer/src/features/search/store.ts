import { create } from 'zustand';

interface SearchUiState {
  filterOpen: boolean;
  /** viewport rect of the button that opened the popover (null → centred under the titlebar) */
  anchor: { right: number; bottom: number } | null;
  openFilters(anchor?: HTMLElement | null): void;
  closeFilters(): void;
  toggleFilters(anchor?: HTMLElement | null): void;
}

const rectOf = (el?: HTMLElement | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom }; };

export const useSearchUi = create<SearchUiState>((set, get) => ({
  filterOpen: false, anchor: null,
  openFilters: (el) => set({ filterOpen: true, anchor: rectOf(el) }),
  closeFilters: () => set({ filterOpen: false }),
  toggleFilters: (el) => (get().filterOpen ? set({ filterOpen: false }) : set({ filterOpen: true, anchor: rectOf(el) })),
}));
