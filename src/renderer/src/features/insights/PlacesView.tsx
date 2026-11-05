import { memo, useMemo, useState } from 'react';
import './insights.css';
import './places.css';
import { ArrowLeft, FolderPlus, Globe2, Grid2x2, MapPin, MapPinOff, Search, X } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '@shared/types';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { Button, EmptyState, IconButton, Segmented } from '@/ui';
import { currentLocale, t as tr, tn, useLang, useT } from '@/i18n';
import { fmtNumber } from '@/lib/format';
import { thumbUrl } from '@/lib/media';
import { aggregatePlaces, CONTINENTS, continentOf, countryName, padBBox, type CityAgg, type Continent, type CountryAgg } from '@/lib/countries';
import { TipProvider } from './charts';
import WorldMap, { type VisitedInfo } from './WorldMap';

type Sort = 'count' | 'name' | 'recent';
const CITY_PAGE = 96;

const years = (a: number, b: number) => {
  const y0 = new Date(a).getUTCFullYear(), y1 = new Date(b).getUTCFullYear();
  return y0 === y1 ? String(y0) : tr('places.range', { from: y0, to: y1 });
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- actions shared by country + city cards */
interface Target { name: string; cc: string; city?: string; bbox: [number, number, number, number] | null; cover: Photo }

function showOnMap(x: Target) {
  const ui = useUi.getState();
  ui.resetFilters();
  ui.setFilters({ countries: [x.cc], ...(x.city ? { query: x.city } : {}) });
  ui.setView('map');
  if (x.bbox) ui.requestFlyTo({ bbox: padBBox(x.bbox, x.city ? 0.08 : 2) });
}
function showPhotos(x: Target) {
  const ui = useUi.getState();
  ui.resetFilters();
  ui.setFilters({ countries: [x.cc], ...(x.city ? { query: x.city } : {}) });
  ui.setView('photos');
}
async function saveAlbum(x: Target) {
  const ui = useUi.getState();
  const city = x.city ? norm(x.city) : null;
  const ids = useLibrary.getState().photos
    .filter((p) => p.place?.countryCode?.toUpperCase() === x.cc && (!city || norm(p.place.city || p.place.region || p.place.country) === city))
    .sort((a, b) => a.sortTime - b.sortTime).map((p) => p.id);
  if (!ids.length) return;
  try {
    const a = await window.api.albums.create({ name: x.name, photoIds: ids, coverPhotoId: x.cover.id });
    ui.toast(tr('places.album.done', { name: x.name }), { tone: 'success', action: { label: tr('places.album.open'), run: () => useUi.getState().openAlbum(a.id) } });
  } catch (e) { ui.toast(String((e as Error).message ?? e), { tone: 'danger' }); }
}

/* ---------- card */
interface CardProps { title: string; code?: string; cover: Photo; count: number; meta: string; target: Target; onOpen: () => void; openLabel: string }
const PlaceCard = memo(function PlaceCard({ title, code, cover, count, meta, target, onOpen, openLabel }: CardProps) {
  const t = useT();
  return (
    <div className="pcard">
      <button className="pcard__main" onClick={onOpen} aria-label={`${title} – ${openLabel}`}>
        <span className="pcard__cover" style={{ background: cover.color ?? 'var(--surface-3)' }}>
          <img src={thumbUrl(cover, 512)} alt="" loading="lazy" decoding="async" draggable={false} />
          {code && <span className="chip">{code}</span>}
        </span>
        <span className="pcard__txt">
          <b className="truncate">{title}</b>
          <span className="pcard__meta truncate"><span className="tabular">{tn('common.photos', count)}</span>{meta && <><i>·</i><span>{meta}</span></>}</span>
        </span>
      </button>
      <span className="pcard__acts">
        <IconButton label={t('places.act.map')} size="sm" glass onClick={() => showOnMap(target)}><MapPin size={15} /></IconButton>
        <IconButton label={t('places.act.photos')} size="sm" glass onClick={() => showPhotos(target)}><Grid2x2 size={15} /></IconButton>
        <IconButton label={t('places.act.album')} size="sm" glass onClick={() => saveAlbum(target)}><FolderPlus size={15} /></IconButton>
      </span>
    </div>
  );
});

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="psearch">
      <Search size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} spellCheck={false} />
      {value && <IconButton label="×" size="sm" onClick={() => onChange('')}><X size={13} /></IconButton>}
    </label>
  );
}

export default function PlacesView() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const photos = useLibrary((s) => s.photos);
  const agg = useMemo(() => aggregatePlaces(photos), [photos]);

  const [cc, setCc] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('count');
  const [continent, setContinent] = useState<Continent | 'all'>('all');
  const [limit, setLimit] = useState(CITY_PAGE);

  const cname = (code: string, raw?: string) => countryName(code, lang, raw);
  const visited = useMemo(() => {
    const m = new Map<string, VisitedInfo>();
    for (const c of agg.countries) m.set(c.cc, { count: c.count, name: c.rawName, cities: c.cities.length, lat: c.lat, lon: c.lon });
    return m;
  }, [agg]);

  const country = cc ? agg.byCode.get(cc) ?? null : null;
  const collator = useMemo(() => new Intl.Collator(currentLocale()), [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const present = useMemo(() => CONTINENTS.filter((c) => agg.countries.some((k) => continentOf(k.cc) === c)), [agg]);

  const countries = useMemo(() => {
    const needle = norm(q.trim());
    let list = agg.countries;
    if (continent !== 'all') list = list.filter((c) => continentOf(c.cc) === continent);
    if (needle) list = list.filter((c) => norm(countryName(c.cc, lang, c.rawName)).includes(needle) || norm(c.rawName).includes(needle) || c.cc.toLowerCase() === needle || c.cities.some((x) => norm(x.city).includes(needle)));
    list = list.slice();
    if (sort === 'name') list.sort((a, b) => collator.compare(countryName(a.cc, lang, a.rawName), countryName(b.cc, lang, b.rawName)));
    else if (sort === 'recent') list.sort((a, b) => b.lastTs - a.lastTs);
    else list.sort((a, b) => b.count - a.count);
    return list;
  }, [agg, q, sort, continent, lang, collator]);

  const cities = useMemo(() => {
    if (!country) return [];
    const needle = norm(q.trim());
    let list = needle ? country.cities.filter((c) => norm(c.city).includes(needle) || (c.region && norm(c.region).includes(needle))) : country.cities.slice();
    if (sort === 'name') list = list.slice().sort((a, b) => collator.compare(a.city, b.city));
    else if (sort === 'recent') list = list.slice().sort((a, b) => b.lastTs - a.lastTs);
    return list;
  }, [country, q, sort, collator]);

  const open = (code: string | null) => { setCc(code); setQ(''); setLimit(CITY_PAGE); };

  if (agg.countries.length === 0 && agg.withoutPlace === 0) {
    return <div className="places"><EmptyState icon={<Globe2 size={28} strokeWidth={1.5} />} title={t('places.empty.title')} hint={t('places.empty.hint')} /></div>;
  }

  const sortSeg = (
    <Segmented<Sort> value={sort} onChange={setSort} options={[{ value: 'count', label: t('places.sort.count') }, { value: 'name', label: t('places.sort.name') }, { value: 'recent', label: t('places.sort.recent') }]} />
  );

  /* ============================== drill-down ============================== */
  if (country) {
    const name = cname(country.cc, country.rawName);
    const target: Target = { name, cc: country.cc, bbox: country.bbox, cover: country.cover };
    const cityTarget = (c: CityAgg): Target => ({ name: c.city, cc: c.cc, city: c.city, bbox: c.bbox, cover: c.cover });
    const shown = cities.slice(0, limit);
    const continentKey = continentOf(country.cc);
    return (
      <TipProvider>
        <div className="places">
          <div className="places__inner">
            <nav className="crumbs" aria-label="breadcrumb">
              <button className="crumbs__back" onClick={() => open(null)}><ArrowLeft size={15} />{t('places.back')}</button>
            </nav>
            <header className="phead">
              <div className="phead__cover"><img src={thumbUrl(country.cover, 512)} alt="" draggable={false} /></div>
              <div className="phead__main">
                <div className="phead__title"><h1>{name}</h1><span className="chip chip--flat">{country.cc}</span></div>
                <p className="phead__sub">{[continentKey && t(`places.continent.${continentKey}`), years(country.firstTs, country.lastTs)].filter(Boolean).join(' · ')}</p>
                <dl className="phead__stats">
                  <div><dt>{t('places.stat.photos')}</dt><dd className="tabular">{fmtNumber(country.count)}</dd></div>
                  <div><dt>{t('places.stat.cities')}</dt><dd className="tabular">{fmtNumber(country.cities.length)}</dd></div>
                  <div><dt>{t('places.stat.span')}</dt><dd className="tabular">{years(country.firstTs, country.lastTs)}</dd></div>
                </dl>
                <div className="phead__acts">
                  <Button variant="primary" icon={<MapPin size={15} />} onClick={() => showOnMap(target)}>{t('places.act.map')}</Button>
                  <Button icon={<Grid2x2 size={15} />} onClick={() => showPhotos(target)}>{t('places.act.photos')}</Button>
                  <Button icon={<FolderPlus size={15} />} onClick={() => saveAlbum(target)}>{t('places.act.album')}</Button>
                </div>
              </div>
            </header>

            {country.cities.some((c) => c.lat != null) && (
              <section className="ins-card places__map">
                <WorldMap visited={visited} focus={{ cc: country.cc, cities: country.cities }} onPickCity={(c) => showPhotos(cityTarget(c))} label={t('places.map.label')} countryLabel={cname} />
              </section>
            )}

            <div className="ptools">
              <h2>{t('places.cities.title')} <span className="ptools__n tabular">{fmtNumber(cities.length)}</span></h2>
              <div className="ptools__r">
                <SearchField value={q} onChange={setQ} placeholder={t('places.search.cities', { country: name })} />
                {sortSeg}
              </div>
            </div>
            {cities.length === 0 ? (
              <EmptyState icon={<Search size={24} strokeWidth={1.5} />} title={t('places.noMatch')} hint={t('places.noMatch.hint')} />
            ) : (
              <div className="pgrid">
                {shown.map((c) => (
                  <PlaceCard key={c.key} title={c.city} cover={c.cover} count={c.count} meta={[c.region, years(c.firstTs, c.lastTs)].filter(Boolean).join(' · ')} target={cityTarget(c)} onOpen={() => showPhotos(cityTarget(c))} openLabel={t('places.act.photos')} />
                ))}
              </div>
            )}
            {cities.length > shown.length && (
              <div className="pmore"><Button onClick={() => setLimit((l) => l + CITY_PAGE)}>{t('places.more', { n: fmtNumber(cities.length - shown.length) })}</Button></div>
            )}
          </div>
        </div>
      </TipProvider>
    );
  }

  /* =============================== overview =============================== */
  const top = agg.countries.slice(0, 5);
  const topMax = top[0]?.count ?? 1;
  const continentsCount = present.length;
  return (
    <TipProvider>
      <div className="places">
        <div className="places__inner">
          <header className="ins__head">
            <h1>{t('places.title')}</h1>
            <p>{t('places.summary', { countries: tn('places.countries', agg.countries.length), cities: tn('places.cities', agg.cityCount) })}{continentsCount > 1 && ` · ${tn('places.continents', continentsCount)}`}</p>
          </header>

          <div className="ptop">
            <section className="ins-card places__map" aria-label={t('places.map.label')}>
              <WorldMap visited={visited} onPickCountry={open} label={t('places.map.label')} countryLabel={cname} />
              <p className="places__maphint">{t('places.map.hint')}</p>
            </section>
            <aside className="pside">
              <div className="ins-card pside__top">
                <h3>{t('places.stat.photos')}</h3>
                <ul>
                  {top.map((c) => (
                    <li key={c.cc}>
                      <button onClick={() => open(c.cc)}>
                        <span className="pside__row"><span className="truncate">{cname(c.cc, c.rawName)}</span><span className="tabular">{fmtNumber(c.count)}</span></span>
                        <span className="rb__track"><span className="rb__fill" style={{ width: `${Math.max(2, (c.count / topMax) * 100)}%` }} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {agg.withoutPlace > 0 && (
                <div className="ins-card pside__none">
                  <MapPinOff size={18} strokeWidth={1.6} />
                  <div>
                    <b>{tn('places.noPlace', agg.withoutPlace)}</b>
                    <p>{t('places.noPlace.hint')}</p>
                  </div>
                  <Button size="sm" onClick={() => { const ui = useUi.getState(); ui.resetFilters(); ui.setFilters({ location: 'without' }); ui.setView('photos'); }}>{t('places.act.photos')}</Button>
                </div>
              )}
            </aside>
          </div>

          <div className="ptools">
            <h2>{t('places.countries.title')} <span className="ptools__n tabular">{fmtNumber(countries.length)}</span></h2>
            <div className="ptools__r">
              <SearchField value={q} onChange={setQ} placeholder={t('places.search.countries')} />
              {sortSeg}
            </div>
          </div>
          {present.length > 1 && (
            <div className="chips" role="group">
              {(['all', ...present] as Array<Continent | 'all'>).map((c) => (
                <button key={c} className={clsx('fchip', continent === c && 'is-on')} aria-pressed={continent === c} onClick={() => setContinent(c)}>{t(`places.continent.${c}`)}</button>
              ))}
            </div>
          )}
          {countries.length === 0 ? (
            <EmptyState icon={<Search size={24} strokeWidth={1.5} />} title={t('places.noMatch')} hint={t('places.noMatch.hint')} />
          ) : (
            <div className="pgrid">
              {countries.map((c: CountryAgg) => (
                <PlaceCard key={c.cc} title={cname(c.cc, c.rawName)} code={c.cc} cover={c.cover} count={c.count}
                  meta={`${tn('places.cities', c.cities.length)} · ${years(c.firstTs, c.lastTs)}`}
                  target={{ name: cname(c.cc, c.rawName), cc: c.cc, bbox: c.bbox, cover: c.cover }} onOpen={() => open(c.cc)} openLabel={t('places.cities.title')} />
              ))}
            </div>
          )}
        </div>
      </div>
    </TipProvider>
  );
}
