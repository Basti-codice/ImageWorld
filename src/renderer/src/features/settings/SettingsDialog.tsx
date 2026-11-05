import './settings.css';
import { useMemo, useState, type ReactNode } from 'react';
import { Cloud, FolderPlus, Info, Keyboard, Map as MapIcon, Monitor, Moon, RefreshCw, Settings as SettingsIcon, ShieldCheck, Sun, Trash2, X, Database } from 'lucide-react';
import type { Settings, Source } from '@shared/types';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { useT } from '@/i18n';
import { fmtNumber } from '@/lib/format';
import { Badge, Button, ConfirmDialog, Dialog, IconButton, Kbd, Segmented, Slider, Switch, Tabs, panelId, tabId } from '@/ui';
import { Logo } from '@/ui/Logo';
import { SourceIcon, pickFolders, removeSource, relativeTime } from '@/shell/sources';
import { useSettingsNav, type SettingsTab } from './nav';
import pkg from '../../../../../package.json';

/* ------------------------------------------------------------------ building blocks */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="sgroup">{title && <h3 className="sgroup__title">{title}</h3>}<div className="sgroup__card">{children}</div></section>;
}
function Row({ label, desc, children, stack }: { label: string; desc?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'srow srow--stack' : 'srow'}>
      <div className="srow__text"><div className="srow__label">{label}</div>{desc && <div className="srow__desc">{desc}</div>}</div>
      {children != null && <div className="srow__ctl">{children}</div>}
    </div>
  );
}

const CACHE_STEPS = [512, 1024, 2048, 3072, 4096, 5120, 8192, 10240, 15360, 20480];
const fmtCache = (mb: number) => (mb >= 1024 ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(mb / 1024)} GB` : `${mb} MB`);
const nearestStep = (mb: number) => CACHE_STEPS.reduce((best, s, i) => (Math.abs(s - mb) < Math.abs(CACHE_STEPS[best] - mb) ? i : best), 0);

/* ------------------------------------------------------------------ panes */
function General({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useT();
  return (
    <>
      <Group title={t('settings.general.appearance')}>
        <Row label={t('settings.language')} desc={t('settings.language.desc')}>
          <Segmented label={t('settings.language')} value={s.language} onChange={(language) => set({ language })} options={[
            { value: 'system', label: t('settings.language.system') }, { value: 'de', label: t('settings.language.de') }, { value: 'en', label: t('settings.language.en') }]} />
        </Row>
        <Row label={t('settings.theme')} desc={t('settings.theme.desc')}>
          <Segmented label={t('settings.theme')} value={s.theme} onChange={(theme) => set({ theme })} options={[
            { value: 'dark', label: <><Moon size={14} />{t('settings.theme.dark')}</> },
            { value: 'light', label: <><Sun size={14} />{t('settings.theme.light')}</> },
            { value: 'system', label: <><Monitor size={14} />{t('settings.theme.system')}</> }]} />
        </Row>
      </Group>
      <Group title={t('settings.general.layout')}>
        <Row label={t('settings.timeline')} desc={t('settings.timeline.desc')}><Switch label={t('settings.timeline')} checked={s.timelineVisible} onChange={(timelineVisible) => set({ timelineVisible })} /></Row>
        <Row label={t('settings.sidebar')} desc={t('settings.sidebar.desc')}><Switch label={t('settings.sidebar')} checked={s.sidebarCollapsed} onChange={(sidebarCollapsed) => set({ sidebarCollapsed })} /></Row>
      </Group>
    </>
  );
}

function MapPane({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useT();
  return (
    <>
      <Group>
        <Row label={t('settings.map.style')} desc={t('settings.map.style.desc')} stack>
          <Segmented label={t('settings.map.style')} value={s.mapStyle} onChange={(mapStyle) => set({ mapStyle })} options={(['dark', 'light', 'satellite', 'voyager'] as const).map((v) => ({ value: v, label: t(`settings.map.style.${v}`) }))} />
        </Row>
        <Row label={t('settings.map.projection')} desc={t('settings.map.projection.desc')}>
          <Segmented label={t('settings.map.projection')} value={s.mapProjection} onChange={(mapProjection) => set({ mapProjection })} options={[{ value: 'globe', label: t('settings.map.projection.globe') }, { value: 'mercator', label: t('settings.map.projection.mercator') }]} />
        </Row>
      </Group>
      <Group title={t('settings.map.layers')}>
        <Row label={t('settings.map.heatmap')} desc={t('settings.map.heatmap.desc')}><Switch label={t('settings.map.heatmap')} checked={s.heatmap} onChange={(heatmap) => set({ heatmap })} /></Row>
        <Row label={t('settings.map.thumbs')} desc={t('settings.map.thumbs.desc')}><Switch label={t('settings.map.thumbs')} checked={s.thumbMarkers} onChange={(thumbMarkers) => set({ thumbMarkers })} /></Row>
        <Row label={t('settings.map.search')} desc={t('settings.map.search.desc')}><Switch label={t('settings.map.search')} checked={s.onlineSearch} onChange={(onlineSearch) => set({ onlineSearch })} /></Row>
      </Group>
    </>
  );
}

function SourceRow({ s, onRemove }: { s: Source; onRemove: () => void }) {
  const t = useT();
  const progress = useLibrary((l) => l.progress[s.id]);
  const scanning = (!!progress && progress.phase !== 'done') || s.status === 'scanning';
  return (
    <div className="srow srcitem">
      <span className="srcitem__icon"><SourceIcon kind={s.kind} size={18} /></span>
      <div className="srow__text">
        <div className="srow__label truncate">{s.label}</div>
        <div className="srow__desc truncate selectable" title={s.path}>{s.path}</div>
      </div>
      <div className="srcitem__meta">
        {scanning ? <Badge tone="accent">{t('settings.sources.scanning')}</Badge>
          : s.status === 'offline' ? <Badge tone="warning">{t('sync.offline')}</Badge>
          : s.status === 'error' ? <Badge tone="danger">{t('sync.error')}</Badge>
          : <span className="srcitem__count tabular">{t('settings.sources.files', { n: fmtNumber(s.photoCount) })}{s.lastScan ? ` · ${relativeTime(s.lastScan)}` : ''}</span>}
      </div>
      <IconButton label={t('settings.sources.rescan')} size="sm" disabled={scanning} onClick={() => { void window.api.sources.rescan(s.id); }}><RefreshCw size={15} /></IconButton>
      <IconButton label={t('settings.sources.remove')} size="sm" onClick={onRemove}><Trash2 size={15} /></IconButton>
    </div>
  );
}

function SourcesPane({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useT();
  const sources = useLibrary((l) => l.sources);
  const [confirm, setConfirm] = useState<Source | null>(null);
  return (
    <>
      <Group title={t('settings.sources.list')}>
        {sources.length === 0 && <div className="srow"><div className="srow__desc">{t('settings.sources.empty')}</div></div>}
        {sources.map((src) => <SourceRow key={src.id} s={src} onRemove={() => setConfirm(src)} />)}
        <div className="srow srow--action"><Button icon={<FolderPlus size={16} />} onClick={() => { void pickFolders(); }}>{t('settings.sources.add')}</Button></div>
      </Group>
      <Group title={t('settings.sources.cloud')}>
        <Row label={t('settings.sources.skipCloud')} desc={t('settings.sources.skipCloud.desc')}>
          <Switch label={t('settings.sources.skipCloud')} checked={s.skipCloudOnlyFiles} onChange={(skipCloudOnlyFiles) => set({ skipCloudOnlyFiles })} />
        </Row>
      </Group>
      {confirm && <ConfirmDialog danger title={t('sources.removeTitle', { name: confirm.label })} message={t('sources.removeBody')} confirmLabel={t('sources.remove')} onConfirm={() => { void removeSource(confirm); }} onClose={() => setConfirm(null)} />}
    </>
  );
}

function StoragePane({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useT();
  const toast = useUi((u) => u.toast);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(() => nearestStep(s.thumbCacheMB));
  const platform = window.api.platform;
  const clear = async () => {
    setBusy(true);
    try { await window.api.shell.clearThumbCache(); toast(t('settings.storage.cleared'), { tone: 'success' }); } catch { toast(t('settings.storage.clearFailed'), { tone: 'danger' }); }
    setBusy(false);
  };
  return (
    <>
      <Group title={t('settings.storage.cache')}>
        <Row label={t('settings.storage.cacheLimit')} desc={t('settings.storage.cacheLimit.desc')} stack>
          <div className="sslider">
            <Slider label={t('settings.storage.cacheLimit')} min={0} max={CACHE_STEPS.length - 1} value={step} format={(i) => fmtCache(CACHE_STEPS[i])}
              onChange={setStep} onCommit={(i) => set({ thumbCacheMB: CACHE_STEPS[i] })} />
            <div className="sslider__ticks tabular"><span>{fmtCache(CACHE_STEPS[0])}</span><b>{fmtCache(CACHE_STEPS[step])}</b><span>{fmtCache(CACHE_STEPS[CACHE_STEPS.length - 1])}</span></div>
          </div>
        </Row>
        <Row label={t('settings.storage.clear')} desc={t('settings.storage.clear.desc')}><Button loading={busy} icon={<Trash2 size={15} />} onClick={clear}>{t('settings.storage.clear')}</Button></Row>
      </Group>
      <Group title={t('settings.storage.data')}>
        <Row label={t('settings.storage.location')} desc={t('settings.storage.data.desc')} stack>
          <code className="spath selectable">{platform === 'win32' ? '%APPDATA%\\ImageWorld' : platform === 'darwin' ? '~/Library/Application Support/ImageWorld' : platform === 'linux' ? '~/.config/ImageWorld' : 'Browser (demo)'}</code>
        </Row>
      </Group>
    </>
  );
}

const ctrlLabel = (t: (k: string) => string) => t('key.ctrl');
function ShortcutsPane() {
  const t = useT();
  const ctrl = ctrlLabel(t);
  const groups: Array<{ title: string; rows: Array<{ label: string; keys: string[] }> }> = [
    { title: t('settings.shortcuts.general'), rows: [
      { label: t('settings.shortcuts.palette'), keys: [ctrl, 'K'] },
      { label: t('settings.shortcuts.settings'), keys: [ctrl, ','] },
      { label: t('settings.shortcuts.help'), keys: ['?'] },
      { label: t('settings.shortcuts.sidebar'), keys: [ctrl, 'B'] },
      { label: t('settings.shortcuts.fullscreen'), keys: ['F11'] },
      { label: t('settings.shortcuts.escape'), keys: ['Esc'] },
    ] },
    { title: t('settings.shortcuts.nav'), rows: [{ label: t('settings.shortcuts.views'), keys: ['1', '–', '5'] }] },
    { title: t('settings.shortcuts.viewer'), rows: [
      { label: t('settings.shortcuts.prev'), keys: ['←', '→'] },
      { label: t('settings.shortcuts.closeViewer'), keys: ['Esc'] },
    ] },
  ];
  return <>{groups.map((g) => (
    <Group key={g.title} title={g.title}>
      {g.rows.map((r) => <Row key={r.label} label={r.label}><span className="keys">{r.keys.map((k, i) => (k === '–' ? <i key={i}>–</i> : <Kbd key={i}>{k}</Kbd>))}</span></Row>)}
    </Group>))}</>;
}

function AboutPane() {
  const t = useT();
  return (
    <>
      <div className="about">
        <Logo size={56} />
        <div><div className="about__name">ImageWorld</div><div className="about__tag">{t('settings.about.tagline')}</div></div>
        <Badge className="about__ver">{t('settings.about.version', { v: pkg.version })}</Badge>
      </div>
      <Group title={t('settings.about.privacy')}>
        <div className="privacy">
          <div className="privacy__lead"><ShieldCheck size={18} />{t('settings.about.privacy.lead')}</div>
          <p>{t('settings.about.p1')}</p>
          <p>{t('settings.about.p2')}</p>
          <table className="svc">
            <thead><tr><th>{t('settings.about.svc')}</th><th>{t('settings.about.svc.what')}</th><th>{t('settings.about.svc.sent')}</th></tr></thead>
            <tbody>
              <tr><td>{t('settings.about.tiles')}</td><td>{t('settings.about.tiles.what')}</td><td>{t('settings.about.tiles.sent')}</td></tr>
              <tr><td>{t('settings.about.nominatim')}</td><td>{t('settings.about.nominatim.what')}</td><td>{t('settings.about.nominatim.sent')}</td></tr>
            </tbody>
          </table>
          <p>{t('settings.about.offline')}</p>
        </div>
      </Group>
      <p className="about__legal">{t('settings.about.license')}</p>
    </>
  );
}

/* ------------------------------------------------------------------ dialog */
const TABS: Array<{ value: SettingsTab; icon: ReactNode }> = [
  { value: 'general', icon: <SettingsIcon size={16} /> }, { value: 'map', icon: <MapIcon size={16} /> }, { value: 'sources', icon: <Cloud size={16} /> },
  { value: 'storage', icon: <Database size={16} /> }, { value: 'shortcuts', icon: <Keyboard size={16} /> }, { value: 'about', icon: <Info size={16} /> },
];

export default function SettingsDialog() {
  const open = useUi((u) => u.settingsOpen);
  if (!open) return null;
  return <SettingsBody />;
}

function SettingsBody() {
  const t = useT();
  const close = () => useUi.getState().setSettingsOpen(false);
  const { tab, setTab } = useSettingsNav();
  const settings = useLibrary((l) => l.settings);
  const setSettings = useLibrary((l) => l.setSettings);
  const set = useMemo(() => (p: Partial<Settings>) => { void setSettings(p); }, [setSettings]);
  const items = TABS.map((x) => ({ value: x.value, icon: x.icon, label: t(`settings.tab.${x.value}`) }));
  return (
    <Dialog flush size="xl" height="min(680px, calc(100vh - 64px))" ariaLabel={t('settings.title')} title={t('settings.title')} onClose={close}>
      <div className="settings">
        <aside className="settings__nav">
          <div className="settings__title">{t('settings.title')}</div>
          <Tabs variant="side" label={t('settings.title')} idPrefix="settings" value={tab} onChange={setTab} items={items} />
          <div className="settings__note">{t('settings.applied')}</div>
        </aside>
        <section className="settings__pane" role="tabpanel" id={panelId('settings', tab)} aria-labelledby={tabId('settings', tab)}>
          <header className="settings__head">
            <h2>{t(`settings.tab.${tab}`)}</h2>
            <IconButton label={t('common.close')} onClick={close} shortcut="Esc"><X size={18} /></IconButton>
          </header>
          <div className="settings__content" key={tab}>
            {tab === 'general' && <General s={settings} set={set} />}
            {tab === 'map' && <MapPane s={settings} set={set} />}
            {tab === 'sources' && <SourcesPane s={settings} set={set} />}
            {tab === 'storage' && <StoragePane s={settings} set={set} />}
            {tab === 'shortcuts' && <ShortcutsPane />}
            {tab === 'about' && <AboutPane />}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
