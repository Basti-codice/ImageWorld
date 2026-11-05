import { useMemo, useState } from 'react';
import './insights.css';
import { BarChart3, Building2, CalendarDays, ChevronLeft, ChevronRight, Globe2, HardDrive, Heart, Images, MapPin, Plane } from 'lucide-react';
import { useLibrary } from '@/state/library';
import { useUi } from '@/state/ui';
import { EmptyState, Segmented, IconButton } from '@/ui';
import { useT, tn, useLang, currentLocale } from '@/i18n';
import { fmtBytes, fmtDate, fmtNumber } from '@/lib/format';
import { thumbUrl } from '@/lib/media';
import { countryName } from '@/lib/countries';
import { detectTrips } from '@/lib/trips';
import type { Filters } from '@/lib/filter';
import { TipProvider, Card, ColumnChart, RowBars, Heatmap, type Col, type Row } from './charts';
import { computeStats, dayRange, yearRange, FOCAL_BINS, APERTURE_BINS } from './stats';

const SERIES = ['var(--accent)', 'var(--viz-2)'];

/** Library-wide drill-down: reset filters, apply patch and jump to the photo grid. */
function openPhotos(patch: Partial<Filters>) {
  const ui = useUi.getState();
  ui.resetFilters();
  ui.setFilters(patch);
  ui.setView('photos');
}

export default function InsightsView() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const photos = useLibrary((s) => s.photos);
  const byId = useLibrary((s) => s.byId);
  const setView = useUi((s) => s.setView);
  const s = useMemo(() => computeStats(photos), [photos]);
  const trips = useMemo(() => {
    try { return detectTrips(photos).slice().sort((a, b) => b.from - a.from).slice(0, 5); } catch { return []; }
  }, [photos]);

  const [gear, setGear] = useState<'cameras' | 'lenses'>('cameras');
  const [yearSel, setYearSel] = useState<number | null>(null);

  const locale = currentLocale();
  const monthLabels = useMemo(() => { const f = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }); return Array.from({ length: 12 }, (_, m) => f.format(Date.UTC(2024, m, 1))); }, [locale]);
  const weekdayLabels = useMemo(() => { const f = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }); return Array.from({ length: 7 }, (_, i) => f.format(Date.UTC(2024, 0, 1 + i))); }, [locale]);
  const dateLong = (ms: number) => fmtDate(ms, { day: 'numeric', month: 'long', year: 'numeric' });

  if (s.total === 0) {
    return <div className="ins"><EmptyState icon={<BarChart3 size={28} strokeWidth={1.5} />} title={t('insights.empty.title')} hint={t('insights.empty.hint')} /></div>;
  }

  const year = yearSel != null && s.yearsWithData.includes(yearSel) ? yearSel : s.lastYear!;
  const yi = s.yearsWithData.indexOf(year);
  const yearActive = (() => { let n = 0; const k0 = Date.UTC(year, 0, 1) / 864e5, k1 = Date.UTC(year + 1, 0, 1) / 864e5; for (let k = k0; k < k1; k++) if (s.daily.has(k)) n++; return n; })();
  const yearTotal = s.perYear.find((y) => y.year === year);

  /* --- per-year columns */
  const peakYear = s.perYear.reduce((a, b) => (b.photos + b.videos > a.photos + a.videos ? b : a), s.perYear[0]);
  const yearCols: Col[] = s.perYear.map((y) => ({
    key: y.year, label: String(y.year), values: [y.photos, y.videos],
    tipTitle: String(y.year),
    tipBody: [tn('common.photos', y.photos), y.videos ? t('insights.videos', { n: fmtNumber(y.videos) }) : ''].filter(Boolean).join(' · '),
    peak: y.year === peakYear.year,
  }));

  const hourPeak = s.hours.indexOf(Math.max(...s.hours));
  const hourCols: Col[] = s.hours.map((n, h) => ({
    key: h, label: String(h), values: [n], peak: h === hourPeak && n > 0,
    tipTitle: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, tipBody: tn('common.photos', n),
  }));
  const dayPeak = s.weekdays.indexOf(Math.max(...s.weekdays));
  const longWeekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  const weekdayCols: Col[] = s.weekdays.map((n, i) => ({
    key: i, label: weekdayLabels[i], values: [n], peak: i === dayPeak && n > 0,
    tipTitle: longWeekday.format(Date.UTC(2024, 0, 1 + i)), tipBody: tn('common.photos', n),
  }));

  const cityRows: Row[] = s.topCities.map((c) => ({
    key: c.key, label: c.city, sub: countryName(c.cc, lang), value: c.count,
    tipTitle: `${c.city}, ${countryName(c.cc, lang)}`, tipBody: tn('common.photos', c.count),
  }));
  const gearList = gear === 'cameras' ? s.cameras : s.lenses;
  const gearRows: Row[] = gearList.map((c) => ({ key: c.key, label: c.label, value: c.count, tipTitle: c.label, tipBody: tn('common.photos', c.count) }));

  const focalCols: Col[] = s.focal.map((n, i) => ({ key: i, label: FOCAL_BINS[i].label, values: [n], tipTitle: `${FOCAL_BINS[i].label} mm`, tipBody: tn('common.photos', n), peak: n > 0 && n === Math.max(...s.focal) }));
  const apCols: Col[] = s.aperture.map((n, i) => ({ key: i, label: APERTURE_BINS[i].label, values: [n], tipTitle: APERTURE_BINS[i].label, tipBody: tn('common.photos', n), peak: n > 0 && n === Math.max(...s.aperture) }));
  const hasFocal = s.focal.some(Boolean), hasAperture = s.aperture.some(Boolean);

  const ratingRows: Row[] = [5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `${n} ★`, value: s.ratings[n], tipTitle: `${n} ★`, tipBody: tn('common.photos', s.ratings[n]) }));
  const favShare = s.total ? s.favorites / s.total : 0;
  const pct = (v: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: v < 0.1 ? 1 : 0 }).format(v);

  return (
    <TipProvider>
      <div className="ins">
        <div className="ins__inner">
          <header className="ins__head">
            <h1>{t('insights.title')}</h1>
            <p>{t('insights.subtitle')}</p>
          </header>

          {/* headline facts */}
          <section className="facts" aria-label={t('insights.title')}>
            <Fact icon={<Images size={15} />} label={t('insights.stat.media')} value={fmtNumber(s.total)} sub={`${tn('common.photos', s.photos)}${s.videos ? ' · ' + t('insights.videos', { n: fmtNumber(s.videos) }) : ''}`} onClick={() => openPhotos({})} />
            <Fact icon={<Globe2 size={15} />} label={t('insights.stat.countries')} value={fmtNumber(s.countries)} sub={t('insights.stat.countries.sub')} onClick={() => setView('places')} />
            <Fact icon={<Building2 size={15} />} label={t('insights.stat.cities')} value={fmtNumber(s.cities)} sub={s.home ? t('insights.stat.cities.sub', { city: s.home.city }) : undefined} onClick={() => setView('places')} />
            <Fact icon={<CalendarDays size={15} />} label={t('insights.stat.years')} value={fmtNumber(s.yearsWithData.length)} sub={s.firstYear === s.lastYear ? String(s.firstYear) : `${s.firstYear}–${s.lastYear}`} />
            <Fact icon={<HardDrive size={15} />} label={t('insights.stat.storage')} value={fmtBytes(s.bytes)} sub={t('insights.stat.storage.sub', { size: fmtBytes(s.bytes / s.total) })} />
          </section>

          <div className="grid">
            <Card className="span-12" title={t('insights.world.title')} hint={t('insights.world.hint')} right={<Legend items={[{ color: SERIES[0], label: t('insights.photos') }, ...(s.videos ? [{ color: SERIES[1], label: t('insights.videos.label') }] : [])]} />}>
              <ColumnChart cols={yearCols} colors={SERIES} height={190} labelEvery={s.perYear.length > 16 ? 2 : 1} ariaLabel={t('insights.world.title')}
                onPick={(c) => openPhotos({ range: yearRange(+c.key) })} />
            </Card>

            <Card className="span-12" title={t('insights.activity.title')} hint={t('insights.activity.hint', { n: fmtNumber(yearActive), year })}
              right={(
                <div className="yearnav">
                  <IconButton label={t('insights.prev')} size="sm" disabled={yi <= 0} onClick={() => setYearSel(s.yearsWithData[yi - 1])}><ChevronLeft size={16} /></IconButton>
                  <button className="yearnav__y tabular" onClick={() => openPhotos({ range: yearRange(year) })} title={t('insights.showYear', { year })}>{year}</button>
                  <IconButton label={t('insights.next')} size="sm" disabled={yi >= s.yearsWithData.length - 1} onClick={() => setYearSel(s.yearsWithData[yi + 1])}><ChevronRight size={16} /></IconButton>
                </div>
              )}>
              <div className="heatwrap">
                <Heatmap year={year} daily={s.daily} monthLabels={monthLabels} weekdayLabels={weekdayLabels} ariaLabel={t('insights.activity.title')}
                  tipFor={(ms, n) => ({ title: dateLong(ms), body: n ? tn('common.photos', n) : t('insights.activity.none') })}
                  onPick={(ms) => openPhotos({ range: dayRange(Math.floor(ms / 864e5)) })} />
                <div className="heatlegend" aria-hidden><span>{t('insights.less')}</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`lv${l}`} />)}<span>{t('insights.more')}</span></div>
              </div>
              <div className="minis">
                {s.busiest && <Mini label={t('insights.busiest')} value={dateLong(s.busiest.day * 864e5)} sub={tn('common.photos', s.busiest.count)} onClick={() => openPhotos({ range: dayRange(s.busiest!.day) })} />}
                {s.streak && <Mini label={t('insights.streak')} value={tn('insights.days', s.streak.len)} sub={s.streak.len > 1 ? `${fmtDate(s.streak.from * 864e5, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(s.streak.to * 864e5, { day: 'numeric', month: 'short', year: 'numeric' })}` : dateLong(s.streak.from * 864e5)} onClick={() => openPhotos({ range: [s.streak!.from * 864e5, (s.streak!.to + 1) * 864e5 - 1] })} />}
                <Mini label={t('insights.activeDays')} value={fmtNumber(s.activeDays)} sub={yearTotal ? t('insights.activeDays.year', { n: fmtNumber(yearActive), year }) : undefined} />
              </div>
            </Card>

            {s.timeKnown > 0 && (
              <>
                <Card className="span-7" title={t('insights.hours.title')} hint={t('insights.hours.hint', { h: String(hourPeak).padStart(2, '0') })}>
                  <ColumnChart cols={hourCols} colors={[SERIES[0]]} height={150} labelEvery={3} maxWidth={22} ariaLabel={t('insights.hours.title')} />
                </Card>
                <Card className="span-5" title={t('insights.weekdays.title')} hint={t('insights.weekdays.hint', { d: longWeekday.format(Date.UTC(2024, 0, 1 + dayPeak)) })}>
                  <ColumnChart cols={weekdayCols} colors={[SERIES[0]]} height={150} maxWidth={34} ariaLabel={t('insights.weekdays.title')} />
                </Card>
              </>
            )}

            {cityRows.length > 0 && (
              <Card className="span-6" title={t('insights.cities.title')} hint={t('insights.cities.hint')}
                right={<button className="textbtn" onClick={() => setView('places')}>{t('insights.allPlaces')}<ChevronRight size={14} /></button>}>
                <RowBars rows={cityRows} ariaLabel={t('insights.cities.title')}
                  onPick={(r) => { const c = s.topCities.find((x) => x.key === r.key)!; openPhotos({ countries: [c.cc], query: c.city }); }} />
              </Card>
            )}
            {gearRows.length > 0 || s.lenses.length > 0 ? (
              <Card className="span-6" title={t('insights.gear.title')} hint={t(gear === 'cameras' ? 'insights.gear.cameras.hint' : 'insights.gear.lenses.hint')}
                right={<Segmented value={gear} onChange={setGear} options={[{ value: 'cameras', label: t('insights.gear.cameras') }, { value: 'lenses', label: t('insights.gear.lenses') }]} />}>
                {gearRows.length ? (
                  <RowBars rows={gearRows} ariaLabel={t('insights.gear.title')}
                    onPick={(r) => openPhotos(gear === 'cameras' ? { cameras: [r.key] } : { query: r.key })} />
                ) : <p className="muted">{t('insights.noData')}</p>}
              </Card>
            ) : null}

            {hasFocal && (
              <Card className="span-4" title={t('insights.focal.title')} hint={t('insights.focal.hint')}>
                <ColumnChart cols={focalCols} colors={[SERIES[0]]} height={140} maxWidth={26} ariaLabel={t('insights.focal.title')} />
              </Card>
            )}
            {hasAperture && (
              <Card className="span-4" title={t('insights.aperture.title')} hint={t('insights.aperture.hint')}>
                <ColumnChart cols={apCols} colors={[SERIES[0]]} height={140} maxWidth={26} ariaLabel={t('insights.aperture.title')} />
              </Card>
            )}
            <Card className="span-4" title={t('insights.rating.title')} hint={t('insights.rating.hint', { n: fmtNumber(s.rated) })}>
              <button className="fav" onClick={() => openPhotos({ favoritesOnly: true })} disabled={!s.favorites}>
                <span className="fav__top"><Heart size={15} fill="currentColor" strokeWidth={0} /><span>{t('insights.favorites')}</span><b className="tabular">{fmtNumber(s.favorites)}</b><em className="tabular">{pct(favShare)}</em></span>
                <span className="fav__track"><span style={{ width: `${Math.max(favShare > 0 ? 1.5 : 0, favShare * 100)}%` }} /></span>
              </button>
              <RowBars rows={ratingRows} ariaLabel={t('insights.rating.title')} onPick={(r) => openPhotos({ minRating: +r.key })} />
            </Card>

            {trips.length > 0 && (
              <Card className={s.furthest ? 'span-8' : 'span-12'} title={t('insights.trips.title')} hint={t('insights.trips.hint')}>
                <ul className="trips">
                  {trips.map((tr) => {
                    const cover = byId.get(tr.photoIds[0]);
                    const range = fmtDate(tr.from, { day: 'numeric', month: 'short', year: 'numeric' }) + (tr.to - tr.from > 864e5 ? ' – ' + fmtDate(tr.to, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
                    return (
                      <li key={tr.id}>
                        <button className="trip" onClick={() => openPhotos({ range: [tr.from, tr.to] })}>
                          <span className="trip__img" style={{ background: cover?.color }}>{cover && <img src={thumbUrl(cover, 256)} alt="" loading="lazy" draggable={false} />}</span>
                          <span className="trip__txt"><b className="truncate">{tr.title}</b><span className="truncate">{range}</span></span>
                          <span className="trip__n tabular">{tn('common.photos', tr.photoIds.length)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
            {s.furthest && s.home && (
              <Card className={trips.length ? 'span-4' : 'span-12'} title={t('insights.furthest.title')} hint={t('insights.furthest.hint', { city: s.home.city })}>
                <button className="far" onClick={() => openPhotos({ countries: [s.furthest!.cc], query: s.furthest!.city })}>
                  <Plane size={18} strokeWidth={1.6} />
                  <span className="far__km tabular">{fmtNumber(Math.round(s.furthest.km))}<small> km</small></span>
                  <span className="far__to"><MapPin size={13} />{s.furthest.city}, {countryName(s.furthest.cc, lang)}</span>
                </button>
              </Card>
            )}
          </div>
        </div>
      </div>
    </TipProvider>
  );
}

function Fact({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub?: string; onClick?: () => void }) {
  const inner = (<><span className="fact__l">{icon}{label}</span><span className="fact__v tabular">{value}</span><span className="fact__s truncate">{sub ?? ' '}</span></>);
  return onClick ? <button className="fact is-link" onClick={onClick}>{inner}</button> : <div className="fact">{inner}</div>;
}

function Mini({ label, value, sub, onClick }: { label: string; value: string; sub?: string; onClick?: () => void }) {
  const inner = (<><span className="mini__l">{label}</span><b className="mini__v">{value}</b>{sub && <span className="mini__s">{sub}</span>}</>);
  return onClick ? <button className="mini is-link" onClick={onClick}>{inner}</button> : <div className="mini">{inner}</div>;
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>;
}
