import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@/styles/global.css';
import '@/shell/shell.css';
import { ensureApi } from '@/api';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import '@/state/derived';
import Titlebar from '@/shell/Titlebar';
import Sidebar from '@/shell/Sidebar';
import PhotosView from '@/features/photos/PhotosView';
import ActiveFilters from '@/features/search/ActiveFilters';
import CommandPalette from '@/features/search/CommandPalette';
import { Toasts } from '@/ui';
import { PhotoGrid } from '@/features/photos/PhotoGrid';

ensureApi();
import { useLang } from '@/i18n';
(window as any).__lang = useLang; (window as any).__ui = useUi; (window as any).__lib = useLibrary;

function Harness() {
  const { view } = useUi();
  const { photos, settings } = useLibrary();
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  return (
    <div className="app">
      <Titlebar />
      <div className="app__body">
        <Sidebar />
        <main className="app__main">
          <ActiveFilters />
          <div className="app__view">{view === 'albums' ? <PhotoGrid photos={photos.slice(0, 40)} grouped={false} header={<div style={{ height: 120, padding: 24 }}>Album hero</div>} /> : <PhotosView />}</div>
        </main>
      </div>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useUi.getState().setCommandPalette(true); } else if (e.key === 'Escape' && !useUi.getState().commandPaletteOpen) useUi.getState().clearSelection(); });
createRoot(document.getElementById('root')!).render(<Harness />);
useLibrary.getState().init();
