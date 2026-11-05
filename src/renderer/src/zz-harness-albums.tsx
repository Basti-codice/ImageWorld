import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/global.css';
import './shell/shell.css';
import { ensureApi } from './api';
import { useLibrary } from './state/library';
import { useUi } from './state/ui';
import './state/derived';
import { Toasts } from './ui';
import AlbumsView from './features/albums/AlbumsView';
import SelectionBar from './features/albums/SelectionBar';
import CreateAlbumDialog from './features/albums/CreateAlbumDialog';
import Viewer from './features/viewer/Viewer';

ensureApi();
(window as any).__ui = useUi; (window as any).__lib = useLibrary;
function H() {
  const view = useUi((s) => s.view);
  const theme = useLibrary((s) => s.settings.theme);
  document.documentElement.dataset.theme = (new URLSearchParams(location.search).get('theme') as string) || theme;
  return (
    <div className="app" style={{ display: 'block', height: '100vh' }}>
      <div className="app__view" style={{ position: 'absolute', inset: 0 }}>
        {view === 'albums' ? <AlbumsView /> : <div style={{ padding: 24 }}>view: {view}</div>}
        <SelectionBar />
      </div>
      <Viewer /><CreateAlbumDialog /><Toasts />
    </div>
  );
}
useLibrary.getState().init().then(() => { useUi.getState().setView('albums'); createRoot(document.getElementById('root')!).render(<H />); });
