import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/global.css';
import { ensureApi } from './api';
import { useLibrary } from './state/library';
import './state/derived';

ensureApi();
const root = createRoot(document.getElementById('root')!);

if (window.api.platform === 'web' && new URLSearchParams(location.search).has('kit')) {
  // Living component reference – plain-browser mock only: http://127.0.0.1:5199/?kit=1 (kept independent of the feature modules)
  import('./ui/Kit').then(({ default: Kit }) => root.render(<StrictMode><Kit /></StrictMode>));
} else {
  Promise.all([import('./shell/App'), import('./shell/ErrorBoundary')]).then(([{ default: App }, { CrashPanel, ErrorBoundary }]) => {
    // render right away (splash); the library index streams in behind it
    root.render(<StrictMode><ErrorBoundary fatal><App /></ErrorBoundary></StrictMode>);
    useLibrary.getState().init().catch((e: unknown) => {
      console.error('[ImageWorld] init failed', e);
      root.render(<StrictMode><CrashPanel fatal error={e} /></StrictMode>);
    });
  });
}
