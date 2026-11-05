// Main process entry. STUB – the backend agent replaces/extends this (protocols, indexing, ipc, tray-less single window).
import { app, BrowserWindow, nativeTheme } from 'electron';
import { join } from 'node:path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    show: false, backgroundColor: '#0c0e13', title: 'ImageWorld',
    titleBarStyle: 'hidden',
    // native Windows 11 caption buttons rendered over our custom title bar (snap layouts keep working)
    titleBarOverlay: { color: '#0c0e13', symbolColor: '#c9ced8', height: 44 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => { nativeTheme.themeSource = 'dark'; createWindow(); });
app.on('window-all-closed', () => app.quit());
