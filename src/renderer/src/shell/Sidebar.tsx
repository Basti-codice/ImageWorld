import { Map as MapIcon, Images, FolderHeart, MapPinned, BarChart3, Settings, FolderPlus } from 'lucide-react';
import { useUi, type View } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useT, tn } from '@/i18n';
import { fmtNumber } from '@/lib/format';

const NAV: Array<{ view: View; icon: typeof MapIcon; key: string }> = [
  { view: 'map', icon: MapIcon, key: 'nav.map' },
  { view: 'photos', icon: Images, key: 'nav.photos' },
  { view: 'albums', icon: FolderHeart, key: 'nav.albums' },
  { view: 'places', icon: MapPinned, key: 'nav.places' },
  { view: 'insights', icon: BarChart3, key: 'nav.insights' },
];

/** STUB-quality sidebar (functional). The design-system agent polishes it: sources list with sync status, album shortcuts, collapse animation. */
export default function Sidebar() {
  const t = useT();
  const { view, setView, setSettingsOpen } = useUi();
  const { photos, albums } = useLibrary();
  return (
    <nav className="sidebar" aria-label={t('nav.library')}>
      <div className="sidebar__section">{t('nav.library')}</div>
      {NAV.map(({ view: v, icon: Icon, key }) => (
        <button key={v} className="nav" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
          <Icon size={18} /><span>{t(key)}</span>
          {v === 'photos' && <span className="nav__count tabular">{fmtNumber(photos.length)}</span>}
          {v === 'albums' && albums.length > 0 && <span className="nav__count tabular">{albums.length}</span>}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button className="nav" onClick={() => window.api.sources.pickAndAdd()}><FolderPlus size={18} /><span>{t('nav.addFolder')}</span></button>
      <button className="nav" onClick={() => setSettingsOpen(true)}><Settings size={18} /><span>{t('nav.settings')}</span></button>
    </nav>
  );
}
