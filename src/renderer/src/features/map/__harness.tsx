// TEMPORARY dev harness for the map agent – deleted before handing over.
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../styles/global.css';
import { ensureApi } from '../../api';
import { useLibrary } from '../../state/library';
import '../../state/derived';
import { useUi } from '../../state/ui';
import { Toasts } from '../../ui';
import MapView from './MapView';
import { MiniMap } from './MiniMap';

ensureApi();
(window as any).__ui = useUi; (window as any).__lib = useLibrary;
useLibrary.getState().init().then(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('stress')) {
    const base = useLibrary.getState().photos.filter((p) => p.lat != null);
    const n = +q.get('stress')!;
    const out = [] as typeof base;
    for (let i = 0; i < n; i++) { const b = base[i % base.length]; out.push({ ...b, id: `${b.id}-${i}`, lat: b.lat! + (Math.random() - 0.5) * 0.4, lon: b.lon! + (Math.random() - 0.5) * 0.5, sortTime: b.sortTime + i }); }
    useLibrary.setState({ photos: out });
  }
  const mini = q.get('mini');
  createRoot(document.getElementById('root')!).render(mini ? (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <MiniMap photos={useLibrary.getState().photos.filter((p) => p.place?.city === 'Tokio')} height={180} route />
      <MiniMap photos={useLibrary.getState().photos.filter((p) => p.place?.city === 'München').slice(0, 40)} height={180} activeId={useLibrary.getState().photos.find((p) => p.place?.city === 'München')?.id} />
      <MiniMap photos={useLibrary.getState().photos.filter((p) => p.lat != null).slice(0, 400)} height={180} />
      <MiniMap photos={useLibrary.getState().photos.filter((p) => p.place?.city === 'Rom').slice(0, 1)} height={180} interactive />
      <MiniMap photos={[]} height={120} />
    </div>
  ) : (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, position: 'relative' }}><MapView /></div>
      <div style={{ height: 148, background: 'var(--surface-1)', borderTop: '1px solid var(--border)' }} />
      <Toasts />
    </div>
  ));
});
