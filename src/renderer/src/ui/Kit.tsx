/* Living component reference – only reachable in the plain-browser mock via ?kit=1 (see main.tsx). */
import './kit.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Cloud, Download, FolderOpen, Heart, Image as ImageIcon, MapPin, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { Avatar, Badge, Button, ConfirmDialog, CountryChip, Dialog, EmptyState, IconButton, Kbd, Menu, Popover, ProgressBar, ProgressRing, SectionLabel, Segmented, Skeleton, Slider, Spinner, Switch, Tabs, TooltipLayer, Toasts, tabPanelProps } from '@/ui';
import { Logo } from '@/ui/Logo';
import { useUi } from '@/state/ui';
import { useLang } from '@/i18n';

const SWATCHES: Array<[string, string]> = [
  ['--bg', 'Window'], ['--surface-1', 'Surface 1 · panels'], ['--surface-2', 'Surface 2 · inputs'], ['--surface-3', 'Surface 3 · hover'], ['--surface-4', 'Surface 4 · pressed'],
  ['--text', 'Text'], ['--text-2', 'Text 2'], ['--text-3', 'Text 3'], ['--accent', 'Accent'], ['--accent-fill', 'Accent fill'], ['--accent-soft', 'Accent soft'],
  ['--success', 'Success'], ['--warning', 'Warning'], ['--danger', 'Danger'], ['--fav', 'Favorite'], ['--select', 'Selection'],
];
const TYPE: Array<[string, string, number, number]> = [['Display', '--fs-3xl', 40, 720], ['Title 1', '--fs-2xl', 28, 700], ['Title 2', '--fs-xl', 20, 650], ['Heading', '--fs-lg', 16, 650], ['Body strong', '--fs-md', 14, 600], ['Body', '--fs-base', 13, 450], ['Caption', '--fs-sm', 12, 450], ['Overline', '--fs-xs', 11, 650]];

function Sec({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="kit__sec"><header><h2>{title}</h2>{hint && <p>{hint}</p>}</header><div className="kit__body">{children}</div></section>;
}
const Row = ({ label, children }: { label?: string; children: ReactNode }) => <div className="kit__row">{label && <span className="kit__rl">{label}</span>}<div className="kit__items">{children}</div></div>;

export default function Kit() {
  const toast = useUi((s) => s.toast);
  const setLanguage = useLang((s) => s.setLanguage);
  const [theme, setTheme] = useState(() => new URLSearchParams(location.search).get('theme') ?? 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [seg, setSeg] = useState('a'); const [sw, setSw] = useState(true); const [sl, setSl] = useState(42); const [tab, setTab] = useState('overview'); const [tab2, setTab2] = useState('map'); const [tab3, setTab3] = useState('general');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pop, setPop] = useState(false); const popBtn = useRef<HTMLButtonElement>(null);
  const [dlg, setDlg] = useState(false); const [confirm, setConfirm] = useState(false);
  const [ring, setRing] = useState(0.62);
  useEffect(() => { const id = setInterval(() => setRing((r) => (r >= 1 ? 0.05 : r + 0.07)), 900); return () => clearInterval(id); }, []);

  return (
    <div className="kit selectable">
      <header className="kit__top">
        <div className="kit__brand"><Logo size={26} /><div><h1>ImageWorld · Design System</h1><p>Tokens and components as shipped. Dark is default, light is first-class.</p></div></div>
        <div className="kit__ctl">
          <Segmented size="sm" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          <Segmented size="sm" value={useLang.getState().lang} onChange={(l) => setLanguage(l as 'de' | 'en')} options={[{ value: 'de', label: 'DE' }, { value: 'en', label: 'EN' }]} />
        </div>
      </header>

      <div className="kit__grid">
        <Sec title="Colour" hint="Neutral surfaces, one accent. Components use tokens only.">
          <div className="kit__sw">{SWATCHES.map(([v, n]) => <div key={v}><i style={{ background: `var(${v})` }} /><b>{n}</b><code>{v}</code></div>)}</div>
        </Sec>

        <Sec title="Typography" hint="Inter Variable · 13 px body · tight tracking from 20 px up.">
          {TYPE.map(([n, v, px, w]) => <div key={n} className="kit__type"><span>{n}<code>{px}/{w}</code></span><div style={{ fontSize: `var(${v})`, fontWeight: w, letterSpacing: px >= 20 ? '-0.02em' : undefined, lineHeight: 1.2 }}>Deine Fotos. Deine Welt.</div></div>)}
        </Sec>

        <Sec title="Elevation & radii">
          <Row>{['--shadow-1', '--shadow-2', '--shadow-3'].map((s) => <div key={s} className="kit__elev" style={{ boxShadow: `var(${s})` }}>{s.replace('--', '')}</div>)}</Row>
          <Row>{['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl'].map((r) => <div key={r} className="kit__rad" style={{ borderRadius: `var(${r})` }}>{r.replace('--r-', '')}</div>)}</Row>
        </Sec>

        <Sec title="Buttons">
          <Row label="Variants"><Button variant="primary" icon={<Plus size={16} />}>Primary</Button><Button>Default</Button><Button variant="ghost">Ghost</Button><Button variant="danger" icon={<Trash2 size={16} />}>Danger</Button><Button disabled>Disabled</Button><Button variant="primary" loading>Loading</Button></Row>
          <Row label="Sizes"><Button size="sm">Small</Button><Button>Medium</Button><Button size="lg" variant="primary" icon={<FolderOpen size={18} />}>Large</Button></Row>
          <Row label="Icon buttons (hover for tooltip)">
            <IconButton label="Search" shortcut="Ctrl K"><Search size={18} /></IconButton>
            <IconButton label="Favorite" active><Heart size={18} /></IconButton>
            <IconButton label="Download"><Download size={18} /></IconButton>
            <IconButton label="Notifications" size="sm"><Bell size={15} /></IconButton>
            <IconButton label="Settings" size="lg"><Settings size={20} /></IconButton>
            <IconButton label="Disabled" disabled><Cloud size={18} /></IconButton>
            <IconButton label="Glass" glass><ImageIcon size={18} /></IconButton>
          </Row>
        </Sec>

        <Sec title="Form controls">
          <Row label="Field"><input className="field" placeholder="Ort, Kamera, Jahr …" style={{ maxWidth: 260 }} /><input className="field" defaultValue="Focused look" style={{ maxWidth: 200 }} /></Row>
          <Row label="Switch"><Switch checked={sw} onChange={setSw} label="Switch" /><Switch checked={!sw} onChange={(v) => setSw(!v)} label="Switch" /><Switch checked disabled onChange={() => {}} label="Disabled" /></Row>
          <Row label="Segmented"><Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Dunkel' }, { value: 'b', label: 'Hell' }, { value: 'c', label: 'System' }]} /><Segmented size="sm" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Dunkel' }, { value: 'b', label: 'Hell' }, { value: 'c', label: 'System' }]} /></Row>
          <Row label="Slider"><div style={{ width: 260 }}><Slider value={sl} min={0} max={100} onChange={setSl} label="Dichte" /></div><span className="tabular" style={{ color: 'var(--text-3)' }}>{sl}</span></Row>
        </Sec>

        <Sec title="Tabs">
          <Tabs value={tab} onChange={setTab} idPrefix="k1" items={[{ value: 'overview', label: 'Überblick' }, { value: 'time', label: 'Zeit', count: 12 }, { value: 'places', label: 'Orte' }, { value: 'x', label: 'Gesperrt', disabled: true }]} />
          <div {...tabPanelProps('k1', tab)} className="kit__panel">Panel: {tab}</div>
          <Row><Tabs variant="pill" value={tab2} onChange={setTab2} items={[{ value: 'map', label: 'Karte', icon: <MapPin size={14} /> }, { value: 'grid', label: 'Raster', icon: <ImageIcon size={14} /> }]} /></Row>
          <div style={{ width: 200 }}><Tabs variant="side" value={tab3} onChange={setTab3} items={[{ value: 'general', label: 'Allgemein', icon: <Settings size={16} /> }, { value: 'map', label: 'Karte', icon: <MapPin size={16} /> }, { value: 'src', label: 'Quellen', icon: <Cloud size={16} />, count: 3 }]} /></div>
        </Sec>

        <Sec title="Status">
          <Row label="Badges"><Badge>Neutral</Badge><Badge tone="accent">Neu</Badge><Badge tone="success">Aktuell</Badge><Badge tone="warning">Offline</Badge><Badge tone="danger">Fehler</Badge><Badge size="sm">12</Badge></Row>
          <Row label="Progress ring"><ProgressRing value={ring} /><ProgressRing value={ring} size={28} stroke={3}>{Math.round(ring * 100)}</ProgressRing><ProgressRing size={40} stroke={3.5} value={ring} tone="success" /><Spinner /><ProgressRing size={22} tone="warning" /></Row>
          <Row label="Progress bar"><div style={{ width: 220 }}><ProgressBar value={ring} /></div><div style={{ width: 220 }}><ProgressBar /></div></Row>
          <Row label="Country / avatar"><CountryChip code="DE" name="Deutschland" /><CountryChip code="JP" name="Japan" /><Avatar name="Mara Weber" /><Avatar name="Tokyo Trip" size={36} /></Row>
          <Row label="Skeleton"><Skeleton width={180} height={14} /><Skeleton width={72} height={72} radius={10} /></Row>
          <Row label="Keys"><Kbd>Ctrl</Kbd><Kbd>K</Kbd><Kbd>?</Kbd></Row>
        </Sec>

        <Sec title="Overlays">
          <Row label="Toasts"><Button size="sm" onClick={() => toast('Ordner hinzugefügt', { tone: 'success' })}>Success</Button><Button size="sm" onClick={() => toast('Auswahl wurde aufgehoben', { action: { label: 'Rückgängig', run: () => {} } })}>Action</Button><Button size="sm" onClick={() => toast('Ordner konnte nicht gelesen werden', { tone: 'danger' })}>Error</Button></Row>
          <Row label="Menu / popover / dialog">
            <Button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>Menü …</Button>
            <Button ref={popBtn} onClick={() => setPop((o) => !o)}>Popover</Button>
            <Button onClick={() => setDlg(true)}>Dialog</Button><Button onClick={() => setConfirm(true)}>Bestätigen</Button>
          </Row>
          <Row label="Empty state"><div className="kit__empty"><EmptyState icon={<ImageIcon size={24} />} title="Keine Fotos gefunden" hint="Passe die Filter an oder füge einen weiteren Ordner hinzu." action={<Button size="sm" icon={<Plus size={14} />}>Ordner hinzufügen</Button>} /></div></Row>
          <SectionLabel>Section label</SectionLabel>
        </Sec>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: 'Neu scannen', icon: <Download size={15} />, onSelect: () => toast('Scan gestartet') },
        { label: 'Im Explorer zeigen', icon: <FolderOpen size={15} />, shortcut: 'Strg E', onSelect: () => {} },
        { label: 'Aktiviert', checked: true, onSelect: () => {} },
        { label: 'Nicht verfügbar', disabled: true, onSelect: () => {} },
        { label: 'Entfernen', icon: <Trash2 size={15} />, danger: true, separatorBefore: true, onSelect: () => {} },
      ]} />}
      <Popover open={pop} onClose={() => setPop(false)} anchor={popBtn} align="start" width={260}><div style={{ padding: 14 }}><b>Popover</b><p style={{ margin: '6px 0 0', color: 'var(--text-2)' }}>Anchored, non-modal. Esc or an outside click closes it and focus returns to the trigger.</p></div></Popover>
      {dlg && <Dialog title="Dialog" onClose={() => setDlg(false)} footer={<><Button variant="ghost" onClick={() => setDlg(false)}>Abbrechen</Button><Button variant="primary" onClick={() => setDlg(false)}>Speichern</Button></>}><div style={{ display: 'grid', gap: 10 }}><p style={{ margin: 0 }}>Focus is trapped inside; Esc closes; focus returns to the opener.</p><input className="field" placeholder="Name" /></div></Dialog>}
      {confirm && <ConfirmDialog danger title="Quelle entfernen?" message="Die Originaldateien bleiben unverändert." confirmLabel="Entfernen" onConfirm={() => toast('Entfernt')} onClose={() => setConfirm(false)} />}
      <Toasts /><TooltipLayer />
    </div>
  );
}
