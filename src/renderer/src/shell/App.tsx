import { useEffect } from 'react';
import './shell.css';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useLang } from '@/i18n';
import Titlebar from './Titlebar';
import Sidebar from './Sidebar';
import Splash from './Splash';
import DropOverlay from './DropOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import { useGlobalShortcuts } from './shortcuts';
import { Toasts, TooltipLayer } from '@/ui';
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
import ActiveFilters from '@/features/search/ActiveFilters';

export default function App() {
  const view = useUi((s) => s.view);
  const loaded = useLibrary((s) => s.loaded);
  const sources = useLibrary((s) => s.sources);
  const settings = useLibrary((s) => s.settings);
  const lang = useLang((s) => s.lang);
  useGlobalShortcuts();

  // theme (follows the OS when set to "system") + language on <html>
  useEffect(() => {
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { root.dataset.theme = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches) ? 'dark' : 'light'; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  if (!loaded) return <Splash />;

  // Onboarding owns the whole window until the first folder was added *and* the user moved on (so the first scan can be watched).
  const onboarding = sources.length === 0 || !settings.onboardingDone;
  const showTimeline = settings.timelineVisible && (view === 'map' || view === 'photos');

  return (
    <div className="app" data-collapsed={!onboarding && settings.sidebarCollapsed} data-onboarding={onboarding}>
      <Titlebar minimal={onboarding} />
      <div className="app__body">
        {onboarding ? (
          <main className="app__main"><ErrorBoundary><Onboarding /></ErrorBoundary></main>
        ) : (
          <>
            <ErrorBoundary><Sidebar /></ErrorBoundary>
            <main className="app__main">
              {(view === 'map' || view === 'photos') && <ErrorBoundary silent><ActiveFilters /></ErrorBoundary>}
              <div className="app__view">
                <ErrorBoundary resetKey={view}>
                  <div key={view} className="view" data-view={view}>
                    {view === 'map' ? <MapView /> : view === 'photos' ? <PhotosView /> : view === 'albums' ? <AlbumsView /> : view === 'places' ? <PlacesView /> : <InsightsView />}
                  </div>
                </ErrorBoundary>
                <ErrorBoundary silent><SelectionBar /></ErrorBoundary>
              </div>
              {showTimeline && <ErrorBoundary silent><TimelineBar /></ErrorBoundary>}
            </main>
          </>
        )}
      </div>
      <ErrorBoundary silent><Viewer /></ErrorBoundary>
      <ErrorBoundary silent><CreateAlbumDialog /></ErrorBoundary>
      <ErrorBoundary silent><CommandPalette /></ErrorBoundary>
      <ErrorBoundary silent><SettingsDialog /></ErrorBoundary>
      <DropOverlay />
      <Toasts />
      <TooltipLayer />
    </div>
  );
}
