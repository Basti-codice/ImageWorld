import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Aperture, BarChart3, Camera, Clock, CornerDownLeft, Flame, FolderHeart, FolderPlus, Globe, Globe2, Heart, Images, ListFilter, Map as MapIcon,
  MapPin, MapPinOff, MapPinned, MoonStar, PanelBottom, RotateCcw, Search, Settings as SettingsIcon, Tag, Video, X, XCircle, Calendar,
} from 'lucide-react';
import clsx from 'clsx';
import type { GeocodeResult } from '@shared/types';
import { Kbd } from '@/ui';
import { tn, useT, useLang } from '@/i18n';
import { useUi, type View } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { activeFilterCount, isKindWord, isYearToken, MONTHS, norm, queryTokens, textMatcher, type Filters } from '@/lib/filter';
import { fmtDate } from '@/lib/format';
import { thumbUrl } from '@/lib/media';
import { countryName } from '@/lib/countries';
import { getIndex, padBBox, endOfMonth, endOfYear, startOfMonth, startOfYear, type BBox } from './searchIndex';
import { highlight } from './highlight';
import { useSearchUi } from './store';
import './search.css';

type GroupId = 'search' | 'recent' | 'places' | 'world' | 'time' | 'gear' | 'tags' | 'albums' | 'photos' | 'actions';
const GROUP_ORDER: GroupId[] = ['search', 'recent', 'places', 'world', 'time', 'gear', 'tags', 'albums', 'photos', 'actions'];
const GROUP_KEY: Record<GroupId, string> = {
  search: 'search.group.search', recent: 'search.group.recent', places: 'search.group.places', world: 'search.group.world', time: 'search.group.time',
  gear: 'search.group.gear', tags: 'search.group.tags', albums: 'search.group.albums', photos: 'search.group.photos', actions: 'search.group.actions',
};

interface Item {
  id: string;
  group: GroupId;
  icon?: ReactNode;
  thumb?: string;
  label: string;
  sub?: string;
  trailing?: string;
  /** label of the Enter action / Shift+Enter action (footer) */
  hint?: string;
  altHint?: string;
  run(alt: boolean): void;
}

/* ------------------------------------------------------------------ recents */
const RECENT_KEY = 'iw.search.recents';
const readRecents = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; } catch { return []; } };
const writeRecents = (r: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6))); } catch { /* storage unavailable */ } };
const pushRecent = (q: string) => { const s = q.trim(); if (s.length < 2) return; writeRecents([s, ...readRecents().filter((x) => x.toLowerCase() !== s.toLowerCase())]); };

/* ------------------------------------------------------------------ matching helpers */
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
/** every token matches the start of a word of `label` (or ≥ 4 chars: anywhere inside) */
function matchesAll(label: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const n = norm(label);
  const words = n.split(WORD_SPLIT);
  return tokens.every((t) => words.some((w) => w.startsWith(t)) || (t.length >= 4 && n.includes(t)));
}
const startsWithAny = (label: string, tokens: string[]) => tokens.length > 0 && norm(label).startsWith(tokens[0]);

interface Parsed { tokens: string[]; text: string[]; years: number[]; months: number[] }
function parseQuery(q: string): Parsed {
  const tokens = queryTokens(q);
  const years: number[] = [], months: number[] = [], text: string[] = [];
  for (const t of tokens) {
    if (isYearToken(t)) years.push(+t);
    else if (t in MONTHS) months.push(MONTHS[t]);
    else if (!isKindWord(t)) text.push(t);
  }
  return { tokens, text, years, months };
}

const flyZoom: Record<NonNullable<GeocodeResult['kind']>, number> = { country: 4, city: 10, place: 12, address: 15 };

/* ------------------------------------------------------------------ component */
export default function CommandPalette() {
  const open = useUi((s) => s.commandPaletteOpen);
  return open ? <Palette /> : null;
}

function Palette() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const close = useCallback(() => useUi.getState().setCommandPalette(false), []);
  const photos = useLibrary((s) => s.photos);
  const albums = useLibrary((s) => s.albums);
  const settings = useLibrary((s) => s.settings);
  const view = useUi((s) => s.view);
  const selectionSize = useUi((s) => s.selection.size);
  const filters = useUi((s) => s.filters);
  const [q, setQ] = useState(() => useUi.getState().filters.query);
  const dq = useDeferredValue(q);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [geo, setGeo] = useState<{ q: string; results: GeocodeResult[] }>({ q: '', results: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => getIndex(photos), [photos]);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  // ---- worldwide place search (debounced 250 ms)
  const parsed = useMemo(() => parseQuery(dq), [dq]);
  const geoQuery = parsed.text.join(' ');
  useEffect(() => {
    if (geoQuery.length < 2 || !settings.onlineSearch) { setGeo({ q: '', results: [] }); return; }
    let cancelled = false;
    const tm = setTimeout(() => {
      window.api.geocode.search(geoQuery).then((results) => { if (!cancelled) setGeo({ q: geoQuery, results }); }).catch(() => { if (!cancelled) setGeo({ q: '', results: [] }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(tm); };
  }, [geoQuery, settings.onlineSearch]);

  // ---- photo text matches (count + first 60 newest)
  const scan = useMemo(() => {
    const m = textMatcher(dq);
    if (!m) return { total: 0, top: [] as typeof photos };
    const top: typeof photos = [];
    let total = 0;
    for (const p of index.byTime) if (m(p)) { total++; if (top.length < 60) top.push(p); }
    return { total, top };
  }, [dq, index]);

  // ---- helpers that apply things
  const afterRun = useCallback((raw: string) => { pushRecent(raw); close(); }, [close]);
  const ctxRange = useMemo<[number, number] | null>(() => {
    if (parsed.years.length !== 1) return null;
    const y = parsed.years[0];
    return parsed.months.length === 1 ? [startOfMonth(y, parsed.months[0]), endOfMonth(y, parsed.months[0])] : [startOfYear(y), endOfYear(y)];
  }, [parsed]);

  const goMapTo = useCallback((bbox: BBox | null, center?: [number, number], zoom?: number) => {
    const ui = useUi.getState();
    ui.setView('map');
    setTimeout(() => useUi.getState().requestFlyTo(bbox ? { bbox } : { center, zoom }), 60);
  }, []);

  /** apply a filter patch and show it either on the map or in the Mediathek (Shift+Enter = the other one) */
  const applyAndShow = useCallback((patch: Partial<Filters>, bbox: BBox | null, alt: boolean) => {
    const ui = useUi.getState();
    ui.setFilters({ query: '', ...(ctxRange ? { range: ctxRange } : {}), ...patch });
    const toMap = (view === 'photos') === alt;
    if (toMap) goMapTo(bbox ? padBBox(bbox) : null);
    else ui.setView('photos');
  }, [view, ctxRange, goMapTo]);

  // ---- build items
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const raw = dq.trim();
    const { text, years, months } = parsed;
    const hasQuery = raw.length > 0;
    const ui = () => useUi.getState();
    const toMap = view !== 'photos';
    const showHint = toMap ? t('search.hint.map') : t('search.hint.photos');
    const altHint = toMap ? t('search.hint.photos') : t('search.hint.map');

    // 1) the query itself
    if (hasQuery) {
      out.push({
        id: 'search', group: 'search', icon: <Search size={16} />, label: t('search.run', { q: raw }), trailing: tn('search.results', scan.total), hint: t('search.hint.photos'),
        run: () => { ui().setFilters({ query: raw }); ui().setView('photos'); afterRun(raw); },
      });
    }

    // 2) recents (empty query)
    if (!hasQuery) {
      for (const r of recents.slice(0, 4)) {
        out.push({ id: `recent:${r}`, group: 'recent', icon: <Clock size={16} />, label: r, hint: t('search.hint.photos'), run: () => { ui().setFilters({ query: r }); ui().setView('photos'); afterRun(r); } });
      }
    }

    // 3) places from the library
    const placeLimit = hasQuery ? 4 : 4;
    const matchedCountries = hasQuery ? index.countries.filter((c) => matchesAll(`${c.name} ${countryName(c.cc, lang)}`, text)) : [];
    const placeRows: Item[] = [];
    if (hasQuery && text.length) {
      for (const c of matchedCountries.slice(0, 2)) {
        placeRows.push({
          id: `country:${c.cc}`, group: 'places', icon: <Globe2 size={16} />, label: countryName(c.cc, lang, c.name), sub: t('search.country'), trailing: tn('common.photos', c.count),
          hint: showHint, altHint, run: (alt) => { applyAndShow({ countries: [c.cc], cities: [] }, c.bbox, alt); afterRun(raw); },
        });
      }
      const pl = index.places.filter((p) => matchesAll(`${p.city} ${p.country} ${countryName(p.cc, lang)}`, text));
      pl.sort((a, b) => Number(startsWithAny(b.city, text)) - Number(startsWithAny(a.city, text)) || b.count - a.count);
      for (const p of pl.slice(0, placeLimit - placeRows.length + 2)) {
        placeRows.push({
          id: `place:${p.key}`, group: 'places', icon: <MapPin size={16} />, label: p.city, sub: countryName(p.cc, lang, p.country), trailing: tn('common.photos', p.count),
          hint: showHint, altHint, run: (alt) => { applyAndShow({ cities: [p.key], countries: [] }, p.bbox, alt); afterRun(raw); },
        });
      }
    } else if (!hasQuery) {
      for (const p of index.places.slice(0, 4)) {
        placeRows.push({
          id: `place:${p.key}`, group: 'places', icon: <MapPin size={16} />, label: p.city, sub: countryName(p.cc, lang, p.country), trailing: tn('common.photos', p.count),
          hint: showHint, altHint, run: (alt) => { applyAndShow({ cities: [p.key], countries: [] }, p.bbox, alt); afterRun(''); },
        });
      }
    }
    out.push(...placeRows.slice(0, 5));

    // 4) worldwide places (geocoder)
    if (hasQuery && geo.q === text.join(' ') && geo.results.length) {
      const have = new Set(placeRows.map((r) => norm(r.label)));
      for (const [i, g] of geo.results.filter((g) => !have.has(norm(g.name))).slice(0, 4).entries()) {
        out.push({
          id: `world:${i}:${g.name}:${g.lat.toFixed(3)}`, group: 'world', icon: <Globe size={16} />, label: g.name, sub: g.detail, hint: t('search.hint.fly'),
          run: () => { goMapTo(g.bbox ?? null, [g.lon, g.lat], flyZoom[g.kind ?? 'place']); afterRun(raw); },
        });
      }
    }

    // 5) time
    const timeRows: Item[] = [];
    const rangeItem = (id: string, label: string, sub: string, from: number, to: number, count: number): Item => ({
      id, group: 'time', icon: <Calendar size={16} />, label, sub, trailing: tn('common.photos', count), hint: t('search.hint.range'),
      run: () => { ui().setFilters({ range: [from, to], query: '' }); afterRun(raw); },
    });
    const monthLabel = (y: number, m: number) => fmtDate(Date.UTC(y, m, 1), { month: 'long', year: 'numeric' });
    if (hasQuery && (years.length || months.length)) {
      if (years.length === 1 && months.length >= 1) {
        for (const m of months.slice(0, 1)) { const e = index.months.find((x) => x.year === years[0] && x.month === m); if (e) timeRows.push(rangeItem(`month:${e.year}-${e.month}`, monthLabel(e.year, e.month), t('search.time.month'), e.from, e.to, e.count)); }
      } else if (years.length) {
        for (const y of years.slice(0, 2)) { const e = index.years.find((x) => x.year === y); if (e) timeRows.push(rangeItem(`year:${y}`, String(y), t('search.time.year'), e.from, e.to, e.count)); }
        if (years.length === 1) for (const m of index.months.filter((x) => x.year === years[0]).sort((a, b) => b.count - a.count).slice(0, 2)) timeRows.push(rangeItem(`month:${m.year}-${m.month}`, monthLabel(m.year, m.month), t('search.time.month'), m.from, m.to, m.count));
      } else {
        for (const m of index.months.filter((x) => months.includes(x.month)).slice(0, 4)) timeRows.push(rangeItem(`month:${m.year}-${m.month}`, monthLabel(m.year, m.month), t('search.time.month'), m.from, m.to, m.count));
      }
    } else if (!hasQuery) {
      for (const y of index.years.slice(0, 3)) timeRows.push(rangeItem(`year:${y.year}`, String(y.year), t('search.time.year'), y.from, y.to, y.count));
    }
    out.push(...timeRows);

    // 6) cameras / lenses / tags
    if (hasQuery && text.length) {
      const gear: Item[] = [];
      for (const c of index.cameras) if (matchesAll(c.name, text)) gear.push({
        id: `cam:${c.name}`, group: 'gear', icon: <Camera size={16} />, label: c.name, sub: t('search.camera'), trailing: tn('common.photos', c.count), hint: t('search.hint.filter'),
        run: () => { const f = ui().filters; ui().setFilters({ query: '', cameras: f.cameras.includes(c.name) ? f.cameras : [...f.cameras, c.name], ...(ctxRange ? { range: ctxRange } : {}) }); if (view !== 'photos' && view !== 'map') ui().setView('photos'); afterRun(raw); },
      });
      for (const c of index.lenses) if (matchesAll(c.name, text)) gear.push({
        id: `lens:${c.name}`, group: 'gear', icon: <Aperture size={16} />, label: c.name, sub: t('search.lens'), trailing: tn('common.photos', c.count), hint: t('search.hint.filter'),
        run: () => { const f = ui().filters; ui().setFilters({ query: '', lenses: f.lenses.includes(c.name) ? f.lenses : [...f.lenses, c.name], ...(ctxRange ? { range: ctxRange } : {}) }); if (view !== 'photos' && view !== 'map') ui().setView('photos'); afterRun(raw); },
      });
      out.push(...gear.slice(0, 4));
      for (const g of index.tags.filter((x) => matchesAll(x.name, text)).slice(0, 3)) out.push({
        id: `tag:${g.name}`, group: 'tags', icon: <Tag size={16} />, label: g.name, trailing: tn('common.photos', g.count), hint: t('search.hint.filter'),
        run: () => { const f = ui().filters; ui().setFilters({ query: '', tags: f.tags.includes(g.name) ? f.tags : [...f.tags, g.name], ...(ctxRange ? { range: ctxRange } : {}) }); if (view !== 'photos' && view !== 'map') ui().setView('photos'); afterRun(raw); },
      });
    }

    // 7) albums
    if (hasQuery && text.length) {
      for (const a of albums.filter((x) => matchesAll(x.name, text)).slice(0, 3)) out.push({
        id: `album:${a.id}`, group: 'albums', icon: <FolderHeart size={16} />, thumb: a.coverPhotoId ? thumbUrl(a.coverPhotoId, 256) : undefined, label: a.name,
        trailing: a.live ? t('search.album.live') : tn('common.photos', a.photoIds.length), hint: t('search.hint.album'), run: () => { ui().openAlbum(a.id); afterRun(raw); },
      });
    }

    // 8) photos
    if (hasQuery && scan.top.length) {
      const ids = scan.top.map((p) => p.id);
      for (const [i, p] of scan.top.slice(0, 5).entries()) out.push({
        id: `photo:${p.id}`, group: 'photos', thumb: thumbUrl(p, 256), label: p.name,
        sub: [p.place?.city, fmtDate(p.sortTime, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · '),
        trailing: p.kind === 'video' ? t('search.video') : undefined, hint: t('search.hint.open'), run: () => { afterRun(raw); ui().openViewer(ids, i); },
      });
    }

    // 9) actions
    const themeDark = document.documentElement.dataset.theme !== 'light';
    const act = (id: string, label: string, icon: ReactNode, keywords: string, run: () => void, sub?: string): Item & { kw: string } => ({ id: `act:${id}`, group: 'actions', icon, label, sub, hint: t('search.hint.run'), run: () => { close(); run(); }, kw: keywords });
    const view_ = (v: View, key: string, icon: ReactNode, kw: string) => act(`view:${v}`, t('search.act.goto', { name: t(key) }), icon, `${t(key)} ${kw}`, () => ui().setView(v));
    const actions: Array<Item & { kw: string }> = [
      view_('map', 'nav.map', <MapIcon size={16} />, 'karte map welt world globus'),
      view_('photos', 'nav.photos', <Images size={16} />, 'mediathek library fotos photos bilder'),
      view_('albums', 'nav.albums', <FolderHeart size={16} />, 'alben albums'),
      view_('places', 'nav.places', <MapPinned size={16} />, 'orte places länder countries'),
      view_('insights', 'nav.insights', <BarChart3 size={16} />, 'statistik insights auswertung stats'),
      act('filters', t('search.act.filters'), <ListFilter size={16} />, 'filter filters facetten', () => useSearchUi.getState().openFilters(null)),
      ...(activeFilterCount(filters) > 0 ? [act('reset', t('search.act.reset'), <RotateCcw size={16} />, 'filter zurücksetzen reset clear', () => ui().resetFilters())] : []),
      act('heatmap', t(settings.heatmap ? 'search.act.heatmapOff' : 'search.act.heatmapOn'), <Flame size={16} />, 'hitzekarte heatmap dichte', () => { void useLibrary.getState().setSettings({ heatmap: !settings.heatmap }); ui().setView('map'); }),
      act('projection', t(settings.mapProjection === 'globe' ? 'search.act.flat' : 'search.act.globe'), <Globe2 size={16} />, 'globus globe flache karte mercator projektion', () => { void useLibrary.getState().setSettings({ mapProjection: settings.mapProjection === 'globe' ? 'mercator' : 'globe' }); }),
      act('theme', t(themeDark ? 'search.act.light' : 'search.act.dark'), <MoonStar size={16} />, 'thema theme dunkel hell dark light modus', () => { void useLibrary.getState().setSettings({ theme: themeDark ? 'light' : 'dark' }); }),
      act('timeline', t(settings.timelineVisible ? 'search.act.timelineOff' : 'search.act.timelineOn'), <PanelBottom size={16} />, 'zeitleiste timeline', () => { void useLibrary.getState().setSettings({ timelineVisible: !settings.timelineVisible }); }),
      act('favorites', t('search.act.favorites'), <Heart size={16} />, 'favoriten favorites herz', () => { ui().setFilters({ favoritesOnly: true }); ui().setView('photos'); }),
      act('videos', t('search.act.videos'), <Video size={16} />, 'videos filme', () => { ui().setFilters({ kinds: ['video'] }); ui().setView('photos'); }),
      act('noloc', t('search.act.noLocation'), <MapPinOff size={16} />, 'standort ohne gps location', () => { ui().setFilters({ location: 'without' }); ui().setView('photos'); }),
      act('addFolder', t('nav.addFolder'), <FolderPlus size={16} />, 'ordner hinzufügen folder add quelle source onedrive', () => { void window.api.sources.pickAndAdd(); }),
      act('settings', t('nav.settings'), <SettingsIcon size={16} />, 'einstellungen settings optionen preferences', () => ui().setSettingsOpen(true)),
      ...(selectionSize > 0 ? [
        act('album', t('sel.createAlbum'), <FolderPlus size={16} />, 'album erstellen create auswahl selection', () => ui().setCreateAlbumOpen(true), tn('sel.count', selectionSize)),
        act('clearSel', t('sel.clear'), <XCircle size={16} />, 'auswahl aufheben clear selection', () => ui().clearSelection()),
      ] : []),
    ];
    const shown = hasQuery ? actions.filter((a) => matchesAll(`${a.label} ${a.kw}`, parsed.tokens)).slice(0, 4) : actions;
    out.push(...shown);
    return out;
  }, [dq, parsed, index, albums, recents, geo, scan, view, lang, t, settings, selectionSize, filters, ctxRange, applyAndShow, afterRun, goMapTo, close]);

  // keep a valid active item (stay on the same item while results stream in)
  useEffect(() => {
    if (!items.length) { setActiveId(null); return; }
    if (!activeId || !items.some((i) => i.id === activeId)) setActiveId(items[0].id);
  }, [items, activeId]);
  useEffect(() => {
    if (!activeId) return;
    (listRef.current?.querySelector(`[data-id="${CSS.escape(activeId)}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const activeIdx = items.findIndex((i) => i.id === activeId);
  const active = activeIdx >= 0 ? items[activeIdx] : undefined;

  const move = (delta: number) => { if (!items.length) return; setActiveId(items[(Math.max(0, activeIdx) + delta + items.length) % items.length].id); };
  const cycleGroup = (dir: 1 | -1) => {
    if (!items.length) return;
    const groups = GROUP_ORDER.filter((g) => items.some((i) => i.group === g));
    const cur = groups.indexOf(active?.group ?? groups[0]);
    const next = groups[(cur + dir + groups.length) % groups.length];
    setActiveId(items.find((i) => i.group === next)!.id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Tab') { e.preventDefault(); cycleGroup(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); active?.run(e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Home' && !q) { e.preventDefault(); setActiveId(items[0]?.id ?? null); }
  };

  const tokens = parsed.tokens;
  let lastGroup: GroupId | null = null;
  const body: ReactNode[] = [];
  for (const it of items) {
    if (it.group !== lastGroup) {
      lastGroup = it.group;
      body.push(
        <div key={`g:${it.group}`} className="cp__group" role="presentation">
          <span>{t(GROUP_KEY[it.group])}</span>
          {it.group === 'recent' && <button className="cp__clear" onClick={() => { writeRecents([]); setRecents([]); }}>{t('search.recent.clear')}</button>}
        </div>,
      );
    }
    const on = it.id === activeId;
    body.push(
      <div
        key={it.id} id={`cp-${it.id}`} data-id={it.id} role="option" aria-selected={on} className={clsx('cp__item', on && 'is-active')}
        onMouseMove={() => { if (!on) setActiveId(it.id); }} onClick={(e) => it.run(e.shiftKey)}
      >
        {it.thumb ? <img className={clsx('cp__thumb', it.group === 'albums' && 'cp__thumb--sq')} src={it.thumb} alt="" draggable={false} /> : <span className="cp__icon">{it.icon}</span>}
        <span className="cp__text">
          <span className="cp__label truncate">{it.group === 'search' || it.group === 'actions' || it.group === 'recent' ? it.label : highlight(it.label, tokens)}</span>
          {it.sub && <span className="cp__sub truncate">{it.group === 'photos' || it.group === 'world' || it.group === 'places' ? highlight(it.sub, tokens) : it.sub}</span>}
        </span>
        {it.trailing && <span className="cp__trail tabular">{it.trailing}</span>}
        {on && <CornerDownLeft size={14} className="cp__enter" />}
      </div>,
    );
  }

  return createPortal(
    <div className="cp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cp" role="dialog" aria-modal="true" aria-label={t('search.palette')}>
        <div className="cp__input">
          <Search size={18} />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={t('search.palette.placeholder')} spellCheck={false} autoComplete="off"
            role="combobox" aria-expanded="true" aria-controls="cp-list" aria-activedescendant={activeId ? `cp-${activeId}` : undefined} aria-label={t('search.palette')}
          />
          {q && <button className="cp__x" aria-label={t('search.clear')} onClick={() => { setQ(''); inputRef.current?.focus(); }}><X size={14} /></button>}
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="cp-list" className="cp__list" role="listbox">
          {items.length ? body : <div className="cp__none">{t('search.none')}</div>}
        </div>
        <footer className="cp__foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('search.foot.nav')}</span>
          <span><Kbd>↵</Kbd>{active?.hint ?? t('search.foot.select')}</span>
          {active?.altHint && <span><Kbd>⇧</Kbd><Kbd>↵</Kbd>{active.altHint}</span>}
          <span><Kbd>Tab</Kbd>{t('search.foot.group')}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
