// Preload: exposes the typed API on window.api. Implemented by the backend agent (see src/main/ipc.ts).
import { contextBridge, ipcRenderer } from 'electron';
import type { ImageWorldApi } from '@shared/types';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const on = <T,>(channel: string, cb: (v: T) => void) => {
  const h = (_: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

const api: ImageWorldApi = {
  platform: process.platform as ImageWorldApi['platform'],
  library: {
    getAll: () => invoke('library:getAll'),
    onChanged: (cb) => on('library:changed', cb),
    update: (ids, patch) => invoke('library:update', ids, patch),
  },
  sources: {
    list: () => invoke('sources:list'),
    pickAndAdd: () => invoke('sources:pickAndAdd'),
    add: (path) => invoke('sources:add', path),
    remove: (id) => invoke('sources:remove', id),
    rescan: (id) => invoke('sources:rescan', id),
    onChanged: (cb) => on('sources:changed', cb),
    onProgress: (cb) => on('sources:progress', cb),
    suggestions: () => invoke('sources:suggestions'),
  },
  albums: {
    list: () => invoke('albums:list'),
    create: (d) => invoke('albums:create', d),
    update: (id, p) => invoke('albums:update', id, p),
    remove: (id) => invoke('albums:remove', id),
    onChanged: (cb) => on('albums:changed', cb),
    exportToFolder: (id) => invoke('albums:export', id),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (p) => invoke('settings:set', p),
    onChanged: (cb) => on('settings:changed', cb),
  },
  geocode: { search: (q) => invoke('geocode:search', q) },
  shell: {
    showInFolder: (id) => invoke('shell:showInFolder', id),
    openOriginal: (id) => invoke('shell:openOriginal', id),
    clearThumbCache: () => invoke('shell:clearThumbCache'),
  },
  window: {
    minimize: () => void invoke('window:minimize'),
    toggleMaximize: () => void invoke('window:toggleMaximize'),
    close: () => void invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onMaximizedChange: (cb) => on('window:maximized', cb),
  },
};

contextBridge.exposeInMainWorld('api', api);
