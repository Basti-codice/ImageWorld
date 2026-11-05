import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/global.css';
import { ensureApi } from './api';
import { useLibrary } from './state/library';
import './state/derived';
import App from './shell/App';

ensureApi();
useLibrary.getState().init().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
});
