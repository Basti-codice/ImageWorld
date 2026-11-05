// DEV-ONLY harness (timeline agent) – mounts the bar alone so screenshots do not depend on other features. Deleted before hand-off.
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '../../styles/global.css';
import { ensureApi } from '../../api';
import { useLibrary } from '../../state/library';
import '../../state/derived';
import TimelineBar from './TimelineBar'; import { useUi } from '../../state/ui'; import { usePlayback } from './playback';
import { Toasts } from '../../ui';

ensureApi();
const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get('theme') ?? 'dark';
(window as unknown as Record<string, unknown>).__lib = useLibrary; (window as unknown as Record<string, unknown>).__ui = useUi; (window as unknown as Record<string, unknown>).__pb = usePlayback;
useLibrary.getState().init().then(() => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>map placeholder</div>
      <TimelineBar />
      <Toasts />
    </div>);
});
