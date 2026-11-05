import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@/styles/global.css';
import '@/ui/ui.css';
import { ensureApi } from '@/api';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import '@/state/derived';
import { Toasts } from '@/ui';
import PlacesView from '@/features/insights/PlacesView';
import InsightsView from '@/features/insights/InsightsView';
ensureApi();
const q = new URLSearchParams(location.search);
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme')!;
function H() {
  const view = useUi((s) => s.view);
  return <div style={{ display: 'flex', height: '100vh' }}><div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>{view === 'places' ? <PlacesView /> : view === 'insights' ? <InsightsView /> : <div id="other" style={{ padding: 20 }}>view: {view} filters {JSON.stringify(useUi.getState().filters)}</div>}</div><Toasts /></div>;
}
useLibrary.getState().init().then(() => { useUi.getState().setView((q.get('view') as any) || 'insights'); createRoot(document.getElementById('root')!).render(<H />); });
;(window as any).__ui = useUi;
