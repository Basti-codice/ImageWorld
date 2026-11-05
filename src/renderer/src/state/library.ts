import { create } from 'zustand';
import type { Album, LibraryDiff, Photo, PhotoPatch, ScanProgress, Settings, Source } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { useLang } from '@/i18n';

interface LibraryState {
  loaded: boolean;
  photos: Photo[];
  byId: Map<string, Photo>;
  sources: Source[];
  albums: Album[];
  progress: Record<string, ScanProgress>;
  settings: Settings;
  init(): Promise<void>;
  applyDiff(d: LibraryDiff): void;
  updatePhotos(ids: string[], patch: PhotoPatch): Promise<void>;
  setSettings(patch: Partial<Settings>): Promise<void>;
}

const index = (photos: Photo[]) => new Map(photos.map((p) => [p.id, p]));

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false, photos: [], byId: new Map(), sources: [], albums: [], progress: {}, settings: DEFAULT_SETTINGS,

  async init() {
    const api = window.api;
    const [settings, photos, sources, albums] = await Promise.all([api.settings.get(), api.library.getAll(), api.sources.list(), api.albums.list()]);
    useLang.getState().setLanguage(settings.language);
    set({ settings, photos, byId: index(photos), sources, albums, loaded: true });
    api.library.onChanged((d) => get().applyDiff(d));
    api.sources.onChanged((sources) => set({ sources }));
    api.sources.onProgress((p) => set((s) => {
      const progress = { ...s.progress, [p.sourceId]: p };
      if (p.phase === 'done') delete progress[p.sourceId];
      return { progress };
    }));
    api.albums.onChanged((albums) => set({ albums }));
    api.settings.onChanged((s) => { useLang.getState().setLanguage(s.language); set({ settings: s }); });
  },

  applyDiff({ added, updated, removedIds }) {
    set((s) => {
      const byId = new Map(s.byId);
      for (const id of removedIds) byId.delete(id);
      for (const p of added) byId.set(p.id, p);
      for (const p of updated) byId.set(p.id, p);
      return { byId, photos: Array.from(byId.values()) };
    });
  },

  async updatePhotos(ids, patch) {
    // optimistic update, backend confirms with a library:changed diff
    set((s) => {
      const byId = new Map(s.byId);
      for (const id of ids) {
        const p = byId.get(id); if (!p) continue;
        const next: Photo = { ...p, ...('favorite' in patch ? { favorite: patch.favorite! } : {}), ...('rating' in patch ? { rating: patch.rating! } : {}), ...('tags' in patch ? { tags: patch.tags! } : {}) };
        if ('location' in patch) {
          if (patch.location) { next.lat = patch.location.lat; next.lon = patch.location.lon; next.geoSource = 'manual'; }
          else if (p.geoSource === 'manual') { next.lat = null; next.lon = null; next.geoSource = null; }
        }
        byId.set(id, next);
      }
      return { byId, photos: Array.from(byId.values()) };
    });
    await window.api.library.update(ids, patch);
  },

  async setSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    if (patch.language) useLang.getState().setLanguage(patch.language);
    await window.api.settings.set(patch);
  },
}));
