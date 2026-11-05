import { useEffect } from 'react';
import './shell.css';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useLang } from '@/i18n';
import Titlebar from './Titlebar';
import Sidebar from './Sidebar';
import { Toasts } from '@/ui';
import MapView from '@/features/map/MapView';
import PhotosView from '@/features/photos/PhotosView';
import AlbumsView from '@/features/albums/AlbumsView';
import PlacesView from '@/features/insights/PlacesView';
import InsightsView from '@/features/insights/InsightsView';
import TimelineBar from '@/features/timeline/TimelineBar';
import Viewer from '@/features/viewer/Viewer';
import SelectionBar from '@/features/albums/SelectionBar';
import CreateAlbumDialog from '@/features/albums/CreateAlbumDialog';
import CommandPalette from '@/features/search/CommandPalette';
import SettingsDialog from '@/features/settings/SettingsDialog';
import Onboarding from '@/features/onboarding/Onboarding';

export default function App() {
  const { view, setCommandPalette, clearSelection } = useUi();
  const { loaded, sources, settings } = useLibrary();
  const lang = useLang((s) => s.lang);

  // theme + language on <html>
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // global shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandPalette(true); }
      else if (e.key === 'Escape' && !useUi.getState().viewer && !useUi.getState().commandPaletteOpen) clearSelection();
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, [setCommandPalette, clearSelection]);

  if (!loaded) return null;
  const showTimeline = settings.timelineVisible && (view === 'map' || view === 'photos');
  const empty = sources.length === 0;

  return (
    <div className="app">
      <Titlebar />
      <div className="app__body" data-collapsed={settings.sidebarCollapsed}>
        <Sidebar />
        <main className="app__main">
          <div className="app__view">
            {empty ? <Onboarding /> : view === 'map' ? <MapView /> : view === 'photos' ? <PhotosView /> : view === 'albums' ? <AlbumsView /> : view === 'places' ? <PlacesView /> : <InsightsView />}
            {!empty && <SelectionBar />}
          </div>
          {!empty && showTimeline && <TimelineBar />}
        </main>
      </div>
      <Viewer />
      <CreateAlbumDialog />
      <CommandPalette />
      <SettingsDialog />
      <Toasts />
    </div>
  );
}
