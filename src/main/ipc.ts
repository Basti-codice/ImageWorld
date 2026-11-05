// IPC surface – one handler per channel used in src/preload/index.ts.
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { AlbumDraft, ExportResult, PhotoPatch, Settings, Source } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AlbumService } from './albums';
import { albumPhotos, exportPhotos } from './export';
import type { GeoSearch } from './geosearch';
import type { Library } from './library';
import type { SourceManager } from './sources';
import type { Store } from './store';
import type { ThumbService } from './thumbs';
import { warn } from './util';
import { applyTheme } from './window';

export interface IpcContext {
  store: Store;
  library: Library;
  sources: SourceManager;
  albums: AlbumService;
  thumbs: ThumbService;
  geo: GeoSearch;
  broadcast: (channel: string, payload: unknown) => void;
}

const THEMES = ['system', 'dark', 'light'];
const LANGS = ['system', 'de', 'en'];
const STYLES = ['dark', 'light', 'satellite', 'voyager'];
const PROJ = ['mercator', 'globe'];

/** keeps only known keys with the right type */
export function sanitizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  const rec = patch as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!(key in rec)) continue;
    const v = rec[key];
    const def = DEFAULT_SETTINGS[key];
    if (typeof v !== typeof def) continue;
    if (key === 'theme' && !THEMES.includes(v as string)) continue;
    if (key === 'language' && !LANGS.includes(v as string)) continue;
    if (key === 'mapStyle' && !STYLES.includes(v as string)) continue;
    if (key === 'mapProjection' && !PROJ.includes(v as string)) continue;
    if (key === 'thumbCacheMB') { const n = Number(v); if (!Number.isFinite(n)) continue; out[key] = Math.max(64, Math.min(1_000_000, Math.round(n))); continue; }
    out[key] = v;
  }
  return out as Partial<Settings>;
}

export function registerIpc(ctx: IpcContext) {
  const { store, library, sources, albums, thumbs, geo } = ctx;
  const win = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  // ---- library
  ipcMain.handle('library:getAll', async () => {
    await sources.ready;
    return library.getAll();
  });
  ipcMain.handle('library:update', (_e, ids: string[], patch: PhotoPatch) => {
    if (!Array.isArray(ids) || !patch || typeof patch !== 'object') return;
    library.update(ids, patch);
    library.flush(true);
  });

  // ---- sources
  ipcMain.handle('sources:list', async () => { await sources.ready; return sources.list(); });
  ipcMain.handle('sources:pickAndAdd', async (e): Promise<Source[]> => {
    const w = win(e);
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'multiSelections'], title: 'ImageWorld' };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    const added: Source[] = [];
    for (const p of r.filePaths) {
      try { added.push(await sources.add(p)); } catch (err) { warn('add source failed', p, err); }
    }
    return added;
  });
  ipcMain.handle('sources:add', (_e, path: string) => sources.add(String(path)));
  ipcMain.handle('sources:remove', (_e, id: string) => sources.remove(id));
  ipcMain.handle('sources:rescan', (_e, id?: string) => { void sources.rescan(id); });
  ipcMain.handle('sources:suggestions', () => sources.suggestions());

  // ---- albums
  ipcMain.handle('albums:list', () => albums.list());
  ipcMain.handle('albums:create', (_e, draft: AlbumDraft) => albums.create(draft));
  ipcMain.handle('albums:update', (_e, id: string, patch) => albums.update(id, patch));
  ipcMain.handle('albums:remove', (_e, id: string) => albums.remove(id));
  ipcMain.handle('albums:export', async (e, id: string): Promise<ExportResult> => {
    const album = albums.get(id);
    if (!album) throw new Error('Album not found');
    const w = win(e);
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: album.name };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { copied: 0, failed: 0, folder: null };
    const photos = albumPhotos(album, library.getAll(), (pid) => library.get(pid));
    return exportPhotos(photos, r.filePaths[0], album.name);
  });

  // ---- settings
  ipcMain.handle('settings:get', () => store.settings.value);
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const clean = sanitizeSettings(patch ?? {});
    const prev = store.settings.value;
    const next: Settings = { ...prev, ...clean };
    store.settings.value = next;
    store.settings.touch();
    if (next.theme !== prev.theme) applyTheme(next.theme);
    if (next.thumbCacheMB < prev.thumbCacheMB) void thumbs.cache.maybeEvict();
    if (prev.skipCloudOnlyFiles && !next.skipCloudOnlyFiles) void sources.rescan(); // fetch metadata of previously skipped placeholders
    ctx.broadcast('settings:changed', next);
    return next;
  });

  // ---- geocode
  ipcMain.handle('geocode:search', (_e, q: string) => geo.search(String(q ?? '')));

  // ---- shell
  ipcMain.handle('shell:showInFolder', (_e, id: string) => {
    const p = library.get(id);
    if (p) shell.showItemInFolder(p.path);
  });
  ipcMain.handle('shell:openOriginal', async (_e, id: string) => {
    const p = library.get(id);
    if (p) { const err = await shell.openPath(p.path); if (err) warn('openPath', err); }
  });
  ipcMain.handle('shell:clearThumbCache', async () => {
    await thumbs.clearCache();
    // re-warm the visible grid lazily; background pre-generation restarts on next scan
  });

  // ---- window
  ipcMain.handle('window:minimize', (e) => win(e)?.minimize());
  ipcMain.handle('window:toggleMaximize', (e) => { const w = win(e); if (!w) return; if (w.isMaximized()) w.unmaximize(); else w.maximize(); });
  ipcMain.handle('window:close', (e) => win(e)?.close());
  ipcMain.handle('window:isMaximized', (e) => win(e)?.isMaximized() ?? false);
}
