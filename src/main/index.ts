// Main process entry: wiring of store, library, sources, thumbnails, protocols, IPC and the window.
import { app, BrowserWindow, Menu, nativeTheme, net, protocol } from 'electron';
import { join } from 'node:path';
import { FILE_PROTOCOL, THUMB_PROTOCOL, type ScanProgress } from '@shared/types';
import heicWorkerPath from './heic-worker?modulePath';
import placesWorkerPath from './places-worker?modulePath';
import { AlbumService } from './albums';
import { CloudChecker } from './cloud';
import { GeoSearch } from './geosearch';
import { registerIpc } from './ipc';
import { Library } from './library';
import { shutdownExifTool } from './metadata';
import { PlaceService } from './place-service';
import { fileHandler, privilegedSchemes, thumbHandler } from './protocols';
import { resolveFfmpegPath } from './render';
import { SourceManager } from './sources';
import { Paths, Store } from './store';
import { ThumbService } from './thumbs';
import { log, warn } from './util';
import { applyTheme, createMainWindow, lockDownSession, stateFileIn } from './window';

// ---- must happen before 'ready'
if (process.env.IMAGEWORLD_USER_DATA) app.setPath('userData', process.env.IMAGEWORLD_USER_DATA);
protocol.registerSchemesAsPrivileged(privilegedSchemes());

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void boot();
}

async function boot() {
  await app.whenReady();
  if (app.isPackaged) Menu.setApplicationMenu(null);
  lockDownSession();

  const paths = new Paths(app.getPath('userData'));
  const store = new Store(paths);
  store.load();
  applyTheme(store.settings.value.theme);

  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  const places = new PlaceService(placesWorkerPath);
  const library = new Library(store, (lat, lon) => places.reverse(lat, lon));
  library.onDiff((d) => broadcast('library:changed', d));

  const thumbs = new ThumbService({
    dir: paths.thumbsDir,
    getPhoto: (id) => {
      const p = library.get(id);
      return p ? { id: p.id, path: p.path, ext: p.ext, mtime: p.mtime, sourceId: p.sourceId, color: p.color, cloudOnly: library.isCloudOnly(id) } : undefined;
    },
    getLimitMB: () => store.settings.value.thumbCacheMB,
    onColor: (id, color) => library.setColor(id, color),
    ffmpegPath: resolveFfmpegPath(),
    heicWorkerFile: heicWorkerPath,
    onBackgroundProgress: (sourceId, done, total) => {
      const p: ScanProgress = { sourceId, phase: done >= total ? 'done' : 'thumbnails', done, total };
      broadcast('sources:progress', p);
    },
  });

  const sources = new SourceManager({
    store, library, places, thumbs,
    cloud: new CloudChecker(),
    settings: () => store.settings.value,
    picturesDir: () => { try { return app.getPath('pictures'); } catch { return undefined; } },
    onSourcesChanged: (list) => broadcast('sources:changed', list),
    onProgress: (p) => broadcast('sources:progress', p),
  });

  const albums = new AlbumService(store, (list) => broadcast('albums:changed', list));
  const geo = new GeoSearch({
    settings: () => store.settings.value,
    places,
    locale: () => app.getLocale(),
    fetch: (url, init) => net.fetch(url, init),
  });

  // ---- protocols
  const pdeps = { thumbs, getPhoto: (id: string) => library.get(id) };
  protocol.handle(THUMB_PROTOCOL, thumbHandler(pdeps));
  protocol.handle(FILE_PROTOCOL, fileHandler(pdeps));

  registerIpc({ store, library, sources, albums, thumbs, geo, broadcast });

  nativeTheme.on('updated', () => { if (store.settings.value.theme === 'system') applyTheme('system'); });

  mainWindow = createMainWindow({
    stateFile: stateFileIn(app.getPath('userData')),
    settings: store.settings.value,
    preload: join(__dirname, '../preload/index.js'),
    isDev,
    rendererIndex: join(__dirname, '../renderer/index.html'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  places.warm();
  void sources.init().then(async () => {
    log(`index loaded: ${library.size} photos from ${store.sources.value.length} sources`);
    const e2e = process.env.IMAGEWORLD_E2E_SOURCE;
    if (e2e) {
      try { await sources.add(e2e); } catch (e) { warn('E2E source failed', e); }
    }
    await sources.start();
  });

  // ---- graceful shutdown: flush stores, persist indexes, stop watchers, end exiftool
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void (async () => {
      try {
        await Promise.race([
          (async () => {
            await sources.shutdown();
            await thumbs.shutdown();
            await places.shutdown();
            await store.flushAll();
            await shutdownExifTool();
          })(),
          new Promise((r) => setTimeout(r, 8000)),
        ]);
      } catch (err) {
        warn('shutdown', err);
      }
      app.exit(0);
    })();
  });
  app.on('window-all-closed', () => app.quit());
}
