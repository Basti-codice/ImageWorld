// Window creation, persisted bounds, theme colours, navigation hardening.
import { BrowserWindow, nativeTheme, screen, session, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings, ThemeMode } from '@shared/types';
import { atomicWrite } from './store';
import { debounce, warn } from './util';

export const THEME_COLORS = {
  dark: { bg: '#0b0d12', symbol: '#c9ced8' },
  light: { bg: '#f4f5f8', symbol: '#2a2f3a' },
} as const;

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return mode;
}

/** nativeTheme + caption-button overlay colours (Windows) for all windows */
export function applyTheme(mode: ThemeMode) {
  nativeTheme.themeSource = mode;
  const c = THEME_COLORS[resolveTheme(mode)];
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.setBackgroundColor(c.bg);
      if (process.platform !== 'darwin') w.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 44 });
    } catch { /* not supported on this platform/window */ }
  }
}

interface SavedState { x?: number; y?: number; width: number; height: number; maximized: boolean }

function loadState(file: string): SavedState | null {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as SavedState;
    if (!(s.width >= 400 && s.height >= 300)) return null;
    if (s.x !== undefined && s.y !== undefined) {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return s.x! < b.x + b.width - 40 && s.x! + s.width > b.x + 40 && s.y! >= b.y - 10 && s.y! < b.y + b.height - 40;
      });
      if (!visible) return { width: s.width, height: s.height, maximized: s.maximized };
    }
    return s;
  } catch {
    return null;
  }
}

export interface WindowOptions {
  stateFile: string;
  settings: Settings;
  preload: string;
  isDev: boolean;
  rendererIndex: string;
  rendererUrl?: string;
}

export function createMainWindow(o: WindowOptions): BrowserWindow {
  const saved = loadState(o.stateFile);
  const colors = THEME_COLORS[resolveTheme(o.settings.theme)];
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: colors.bg,
    title: 'ImageWorld',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.symbol, height: 44 },
    webPreferences: {
      preload: o.preload,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      devTools: o.isDev,
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // ---- persist bounds
  const save = debounce(() => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    const s: SavedState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    atomicWrite(o.stateFile, JSON.stringify(s)).catch((e) => warn('window state', e));
  }, 600);
  win.on('resize', save);
  win.on('move', save);
  win.on('close', () => save.flush());

  const sendMax = () => { if (!win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized()); };
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  // ---- hardening: no navigation away from the app, no popups; links open in the default browser
  const openExternal = (url: string) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); };
  win.webContents.on('will-navigate', (e, url) => {
    const cur = win.webContents.getURL();
    if (url === cur || url.split('#')[0] === cur.split('#')[0]) return; // reloads / hash routes of the app itself
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'Escape' && win.isFullScreen() && !input.control && !input.alt) { /* let the renderer handle Esc first; no auto exit */ }
    else if (!o.isDev && ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5' || (input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12')) e.preventDefault();
  });

  if (o.rendererUrl) void win.loadURL(o.rendererUrl);
  else void win.loadFile(o.rendererIndex);
  return win;
}

/** deny every permission request except fullscreen (video player) */
export function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
}

export const stateFileIn = (userData: string) => join(userData, 'window.json');
