import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { BarChart3, Clock, Copy, Ellipsis, FolderOpen, FolderPlus, Film, FolderHeart, Heart, Images, Map as MapIcon, MapPinned, MapPinOff, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings, Trash2, TriangleAlert, WifiOff } from 'lucide-react';
import type { Source } from '@shared/types';
import { useUi, type View } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useT } from '@/i18n';
import { fmtNumber } from '@/lib/format';
import { ConfirmDialog, IconButton, Menu, ProgressRing, SectionLabel, type MenuItem } from '@/ui';
import { openSettings } from '@/features/settings/nav';
import { SourceIcon, pickFolders, progressRatio, removeSource, revealSource } from './sources';

const NAV: Array<{ view: View; icon: typeof MapIcon; key: string; shortcut: string }> = [
  { view: 'map', icon: MapIcon, key: 'nav.map', shortcut: '1' },
  { view: 'photos', icon: Images, key: 'nav.photos', shortcut: '2' },
  { view: 'albums', icon: FolderHeart, key: 'nav.albums', shortcut: '3' },
  { view: 'places', icon: MapPinned, key: 'nav.places', shortcut: '4' },
  { view: 'insights', icon: BarChart3, key: 'nav.insights', shortcut: '5' },
];
const RECENT_DAYS = 30;

interface RowProps {
  icon: ReactNode; label: string; count?: ReactNode; active?: boolean; collapsed: boolean; small?: boolean; shortcut?: string;
  onClick: () => void; onContextMenu?: (e: MouseEvent) => void; trailing?: ReactNode; title?: string; className?: string;
}
/** One sidebar row. In the collapsed rail the label is clipped and a tooltip takes over. */
function Row({ icon, label, count, active, collapsed, small, shortcut, onClick, onContextMenu, trailing, className }: RowProps) {
  return (
    <div className={clsx('navrow', trailing && 'navrow--aside')}>
      <button
        type="button" className={clsx('nav', small && 'nav--sm', className)} aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        data-tip={collapsed ? label : undefined} data-tip-kbd={collapsed ? shortcut : undefined} data-tip-side="right"
        onClick={onClick} onContextMenu={onContextMenu}
      >
        <span className="nav__icon">{icon}</span>
        <span className="nav__label truncate">{label}</span>
        {count != null && <span className="nav__count tabular">{count}</span>}
      </button>
      {trailing && <div className="navrow__aside">{trailing}</div>}
    </div>
  );
}

export default function Sidebar() {
  const t = useT();
  const { view, setView, openAlbum, albumId, filters, setFilters } = useUi();
  const { photos, albums, sources, progress, settings, setSettings } = useLibrary();
  const collapsed = settings.sidebarCollapsed;
  const [menu, setMenu] = useState<{ x: number; y: number; source: Source } | null>(null);
  const [confirm, setConfirm] = useState<Source | null>(null);

  const stats = useMemo(() => {
    let fav = 0, vid = 0, noLoc = 0, geo = 0, newest = 0;
    const places = new Set<string>();
    for (const p of photos) {
      if (p.favorite) fav++;
      if (p.kind === 'video') vid++;
      if (p.lat == null) noLoc++; else geo++;
      if (p.sortTime > newest) newest = p.sortTime;
      if (p.place) places.add(`${p.place.countryCode}|${p.place.city}`);
    }
    const from = newest - RECENT_DAYS * 864e5;
    let recent = 0; for (const p of photos) if (p.sortTime >= from) recent++;
    return { fav, vid, noLoc, geo, places: places.size, recent, from, newest };
  }, [photos]);

  /** shortcuts are filters; on views that don't show filtered photos they also navigate to the library */
  const goFiltered = () => { if (view !== 'map' && view !== 'photos') setView('photos'); };
  const sameRange = filters.range != null && Math.abs(filters.range[0] - stats.from) < 1000 && filters.range[1] >= stats.newest;
  const shortcuts = [
    { id: 'fav', icon: <Heart size={16} />, label: t('nav.favorites'), count: stats.fav, active: filters.favoritesOnly, run: () => { setFilters({ favoritesOnly: !filters.favoritesOnly }); goFiltered(); } },
    { id: 'vid', icon: <Film size={16} />, label: t('nav.videos'), count: stats.vid, active: filters.kinds.length === 1 && filters.kinds[0] === 'video', run: () => { setFilters({ kinds: filters.kinds.includes('video') ? [] : ['video'] }); goFiltered(); } },
    { id: 'noloc', icon: <MapPinOff size={16} />, label: t('nav.noLocation'), count: stats.noLoc, active: filters.location === 'without', run: () => { setFilters({ location: filters.location === 'without' ? 'any' : 'without' }); goFiltered(); } },
    { id: 'recent', icon: <Clock size={16} />, label: t('nav.recent'), count: stats.recent, active: sameRange, run: () => { setFilters({ range: sameRange ? null : [stats.from, stats.newest + 864e5] }); goFiltered(); } },
  ];

  const navCount = (v: View) => v === 'map' ? fmtNumber(stats.geo) : v === 'photos' ? fmtNumber(photos.length) : v === 'albums' ? (albums.length || undefined) : v === 'places' ? (stats.places || undefined) : undefined;
  const sourceActive = (s: Source) => filters.sourceIds.length === 1 && filters.sourceIds[0] === s.id;
  const toggleSource = (s: Source) => { setFilters({ sourceIds: sourceActive(s) ? [] : [s.id] }); goFiltered(); };

  const openMenu = (e: MouseEvent, source: Source) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, source }); };
  const menuItems = (s: Source): MenuItem[] => {
    const first = photos.find((p) => p.sourceId === s.id)?.id;
    return [
      { label: t('sources.rescan'), icon: <RefreshCw size={15} />, onSelect: () => { void window.api.sources.rescan(s.id); } },
      { label: t('sources.reveal'), icon: <FolderOpen size={15} />, onSelect: () => { void revealSource(s, first); } },
      { label: t('sources.copyPath'), icon: <Copy size={15} />, onSelect: () => { void navigator.clipboard?.writeText(s.path); useUi.getState().toast(t('sources.pathCopied')); } },
      { label: t('sources.remove'), icon: <Trash2 size={15} />, danger: true, separatorBefore: true, onSelect: () => setConfirm(s) },
    ];
  };

  const topAlbums = albums.slice(0, 5);

  return (
    <nav className={clsx('sidebar', collapsed && 'sidebar--collapsed')} aria-label={t('nav.library')}>
      <div className="sidebar__scroll">
        <SectionLabel className="sidebar__label">{t('nav.library')}</SectionLabel>
        {NAV.map(({ view: v, icon: Icon, key, shortcut }) => (
          <Row key={v} icon={<Icon size={18} />} label={t(key)} shortcut={shortcut} count={navCount(v)} active={view === v} collapsed={collapsed} onClick={() => setView(v)} />
        ))}

        <div className="sidebar__gap" />
        <SectionLabel className="sidebar__label">{t('nav.collections')}</SectionLabel>
        {shortcuts.map((s) => (
          <Row key={s.id} small icon={s.icon} label={s.label} count={fmtNumber(s.count)} active={s.active} collapsed={collapsed} onClick={s.run} />
        ))}

        {topAlbums.length > 0 && !collapsed && (
          <>
            <div className="sidebar__gap" />
            <SectionLabel className="sidebar__label" action={<button type="button" className="sidebar__link" onClick={() => setView('albums')}>{t('common.all')}</button>}>{t('nav.albums')}</SectionLabel>
            {topAlbums.map((a) => (
              <Row key={a.id} small collapsed={false} icon={<span className="albumdot" style={{ background: a.color ?? 'var(--text-3)' }} />} label={a.name} count={a.live ? undefined : fmtNumber(a.photoIds.length)} active={view === 'albums' && albumId === a.id} onClick={() => openAlbum(a.id)} />
            ))}
          </>
        )}

        <div className="sidebar__gap" />
        <SectionLabel className="sidebar__label">{t('nav.sources')}</SectionLabel>
        {sources.map((s) => {
          const p = progress[s.id];
          const scanning = (!!p && p.phase !== 'done') || s.status === 'scanning';
          const status = scanning ? t('sync.scanning') : s.status === 'offline' ? t('sync.offline') : s.status === 'error' ? (s.error ?? t('sync.error')) : '';
          return (
            <Row
              key={s.id} small collapsed={collapsed} label={s.label} active={sourceActive(s)}
              icon={<span className={clsx('srcicon', s.status === 'offline' && 'srcicon--warn', s.status === 'error' && 'srcicon--err')}><SourceIcon kind={s.kind} />{collapsed && scanning && <i className="srcicon__dot" />}</span>}
              count={scanning || s.status === 'offline' || s.status === 'error' ? undefined : fmtNumber(s.photoCount)}
              onClick={() => toggleSource(s)} onContextMenu={(e) => openMenu(e, s)}
              className="nav--source"
              trailing={<>
                {scanning && <span className="nav__status" data-tip={status} data-tip-side="right"><ProgressRing size={14} stroke={2} value={progressRatio(p)} label={status} /></span>}
                {!scanning && s.status === 'offline' && <span className="nav__status nav__status--warn" data-tip={status} data-tip-side="right"><WifiOff size={14} /></span>}
                {!scanning && s.status === 'error' && <span className="nav__status nav__status--err" data-tip={status} data-tip-side="right"><TriangleAlert size={14} /></span>}
                <button
                  type="button" aria-label={t('sources.more')} className="nav__more" aria-haspopup="menu"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, source: s }); }}
                ><Ellipsis size={16} /></button>
              </>}
            />
          );
        })}
        <Row small collapsed={collapsed} icon={<FolderPlus size={16} />} label={t('nav.addFolder')} onClick={() => { void pickFolders(); }} className="nav--add" />
      </div>

      <div className="sidebar__foot">
        <Row collapsed={collapsed} icon={<Settings size={18} />} label={t('nav.settings')} shortcut={`${t('key.ctrl')} ,`} onClick={() => openSettings()} />
        <IconButton
          label={collapsed ? t('nav.expand') : t('nav.collapse')} shortcut={`${t('key.ctrl')} B`} tipSide="right" className="sidebar__toggle"
          onClick={() => { void setSettings({ sidebarCollapsed: !collapsed }); }} aria-expanded={!collapsed}
        >{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</IconButton>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(menu.source)} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmDialog
          danger title={t('sources.removeTitle', { name: confirm.label })} message={t('sources.removeBody')} confirmLabel={t('sources.remove')}
          onConfirm={() => { void removeSource(confirm); }} onClose={() => setConfirm(null)}
        />
      )}
    </nav>
  );
}
