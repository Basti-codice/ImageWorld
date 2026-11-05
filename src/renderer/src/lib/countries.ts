import type { Photo } from '@shared/types';

/* ------------------------------------------------------------------ names */

const dnCache = new Map<string, Intl.DisplayNames | null>();
const regionNames = (lang: string): Intl.DisplayNames | null => {
  if (!dnCache.has(lang)) {
    try { dnCache.set(lang, new Intl.DisplayNames([lang], { type: 'region' })); } catch { dnCache.set(lang, null); }
  }
  return dnCache.get(lang)!;
};

/** Localised country name from an ISO 3166-1 alpha-2 code ("DE" → "Deutschland" / "Germany"). Falls back to `fallback` or the code. */
export function countryName(cc: string, lang: string = 'de', fallback?: string): string {
  const code = cc.toUpperCase();
  try {
    const n = regionNames(lang)?.of(code);
    if (n && n !== code) return n;
  } catch { /* invalid code */ }
  return fallback || code;
}

/* -------------------------------------------------------------- continents */

export type Continent = 'EU' | 'AS' | 'AF' | 'NA' | 'SA' | 'OC' | 'AN';
export const CONTINENTS: Continent[] = ['EU', 'AS', 'AF', 'NA', 'SA', 'OC', 'AN'];

const CONTINENT_CODES: Record<Continent, string> = {
  EU: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  AS: 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  NA: 'AG AI AW BB BL BM BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  SA: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  OC: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
  AN: 'AQ BV GS HM TF',
};
const CONTINENT_OF = new Map<string, Continent>();
for (const c of CONTINENTS) for (const cc of CONTINENT_CODES[c].split(' ')) CONTINENT_OF.set(cc, c);

/** Continent of a country code; unknown codes map to undefined. */
export const continentOf = (cc: string): Continent | undefined => CONTINENT_OF.get(cc.toUpperCase());

/* --------------------------------------------- ISO numeric (world-atlas ids) */

const NUMERIC_PAIRS = `242FJ 834TZ 732EH 124CA 840US 398KZ 860UZ 598PG 360ID 032AR 152CL 180CD 706SO 404KE 729SD 148TD 332HT 214DO 643RU 044BS 238FK 578NO 304GL 260TF 626TL 710ZA 426LS 484MX 858UY 076BR 068BO 604PE 170CO 591PA 188CR 558NI 340HN 222SV 320GT 084BZ 862VE 328GY 740SR 250FR 218EC 630PR 388JM 192CU 716ZW 072BW 516NA 686SN 466ML 478MR 204BJ 562NE 566NG 120CM 768TG 288GH 384CI 324GN 624GW 430LR 694SL 854BF 140CF 178CG 266GA 226GQ 894ZM 454MW 508MZ 748SZ 024AO 108BI 376IL 422LB 450MG 275PS 270GM 788TN 012DZ 400JO 784AE 634QA 414KW 368IQ 512OM 548VU 116KH 764TH 418LA 104MM 704VN 408KP 410KR 496MN 356IN 050BD 064BT 524NP 586PK 004AF 762TJ 417KG 795TM 364IR 760SY 051AM 752SE 112BY 804UA 616PL 040AT 348HU 498MD 642RO 440LT 428LV 233EE 276DE 100BG 300GR 792TR 008AL 191HR 756CH 442LU 056BE 528NL 620PT 724ES 372IE 540NC 090SB 554NZ 036AU 144LK 156CN 158TW 380IT 208DK 826GB 352IS 031AZ 268GE 608PH 458MY 096BN 705SI 246FI 703SK 203CZ 232ER 392JP 600PY 887YE 682SA 010AQ 196CY 504MA 818EG 434LY 231ET 262DJ 800UG 646RW 070BA 807MK 688RS 499ME 780TT 728SS`;
const NUM_TO_CC = new Map<number, string>();
for (const p of NUMERIC_PAIRS.split(' ')) NUM_TO_CC.set(+p.slice(0, 3), p.slice(3));

/** world-atlas feature (id = ISO numeric, name) → alpha-2 code, or undefined for unmapped territories. */
export function atlasCountryCode(id: string | number | undefined, name?: string): string | undefined {
  if (id != null && id !== '') return NUM_TO_CC.get(+id);
  if (name === 'Kosovo') return 'XK';
  return undefined;
}

/* ----------------------------------------------------------- place aggregate */

export type BBox = [number, number, number, number];

export interface CityAgg {
  key: string;
  city: string;
  region?: string;
  cc: string;
  count: number;
  firstTs: number;
  lastTs: number;
  cover: Photo;
  /** mean position of geotagged photos (null if none) */
  lat: number | null;
  lon: number | null;
  geoCount: number;
  bbox: BBox | null;
}

export interface CountryAgg {
  cc: string;
  /** name as stored in the index (fallback if Intl has none) */
  rawName: string;
  count: number;
  firstTs: number;
  lastTs: number;
  cover: Photo;
  cities: CityAgg[];
  lat: number | null;
  lon: number | null;
  geoCount: number;
  bbox: BBox | null;
}

export interface PlacesAgg {
  countries: CountryAgg[];
  byCode: Map<string, CountryAgg>;
  cityCount: number;
  /** photos that carry no place and no coordinates */
  withoutPlace: number;
  withPlace: number;
}

/** better cover = favourite > rating > photo over video > newest */
function betterCover(a: Photo, b: Photo): boolean {
  if (a.favorite !== b.favorite) return a.favorite;
  if (a.rating !== b.rating) return a.rating > b.rating;
  if ((a.kind === 'photo') !== (b.kind === 'photo')) return a.kind === 'photo';
  return a.sortTime > b.sortTime;
}

interface Acc { count: number; first: number; last: number; cover: Photo; sLat: number; sLon: number; geo: number; w: number; s: number; e: number; n: number }
const newAcc = (p: Photo): Acc => ({ count: 0, first: p.sortTime, last: p.sortTime, cover: p, sLat: 0, sLon: 0, geo: 0, w: 180, s: 90, e: -180, n: -90 });
function addTo(a: Acc, p: Photo) {
  a.count++;
  if (p.sortTime < a.first) a.first = p.sortTime;
  if (p.sortTime > a.last) a.last = p.sortTime;
  if (betterCover(p, a.cover)) a.cover = p;
  if (p.lat != null && p.lon != null) {
    a.geo++; a.sLat += p.lat; a.sLon += p.lon;
    if (p.lon < a.w) a.w = p.lon; if (p.lon > a.e) a.e = p.lon; if (p.lat < a.s) a.s = p.lat; if (p.lat > a.n) a.n = p.lat;
  }
}
const bboxOf = (a: Acc): BBox | null => (a.geo ? [a.w, a.s, a.e, a.n] : null);

let lastPhotos: Photo[] | null = null;
let lastAgg: PlacesAgg | null = null;

/** One pass over the library: countries → cities with covers, counts, centroids, bounding boxes. Memoised on the photos array identity. */
export function aggregatePlaces(photos: Photo[]): PlacesAgg {
  if (lastPhotos === photos && lastAgg) return lastAgg;
  const countries = new Map<string, { acc: Acc; raw: string; cities: Map<string, { acc: Acc; city: string; region?: string }> }>();
  let withoutPlace = 0, withPlace = 0;
  for (const p of photos) {
    const pl = p.place;
    if (!pl || !pl.countryCode) { if (p.lat == null) withoutPlace++; continue; }
    withPlace++;
    const cc = pl.countryCode.toUpperCase();
    let c = countries.get(cc);
    if (!c) { c = { acc: newAcc(p), raw: pl.country, cities: new Map() }; countries.set(cc, c); }
    addTo(c.acc, p);
    const cityName = pl.city || pl.region || pl.country;
    const ck = `${cityName}\u0000${pl.region ?? ''}`;
    let ci = c.cities.get(ck);
    if (!ci) { ci = { acc: newAcc(p), city: cityName, region: pl.region }; c.cities.set(ck, ci); }
    addTo(ci.acc, p);
  }
  let cityCount = 0;
  const list: CountryAgg[] = [];
  for (const [cc, c] of countries) {
    const cities: CityAgg[] = [];
    for (const [k, ci] of c.cities) {
      const a = ci.acc;
      cities.push({
        key: `${cc}:${k}`, city: ci.city, region: ci.region, cc, count: a.count, firstTs: a.first, lastTs: a.last, cover: a.cover,
        lat: a.geo ? a.sLat / a.geo : null, lon: a.geo ? a.sLon / a.geo : null, geoCount: a.geo, bbox: bboxOf(a),
      });
    }
    cities.sort((x, y) => y.count - x.count);
    cityCount += cities.length;
    const a = c.acc;
    list.push({
      cc, rawName: c.raw, count: a.count, firstTs: a.first, lastTs: a.last, cover: a.cover, cities,
      lat: a.geo ? a.sLat / a.geo : null, lon: a.geo ? a.sLon / a.geo : null, geoCount: a.geo, bbox: bboxOf(a),
    });
  }
  list.sort((x, y) => y.count - x.count);
  lastPhotos = photos;
  lastAgg = { countries: list, byCode: new Map(list.map((c) => [c.cc, c])), cityCount, withoutPlace, withPlace };
  return lastAgg;
}

/** Pads a bbox so a single point / tiny area still yields a sensible map view. */
export function padBBox(b: BBox, minSpan = 0.12): BBox {
  let [w, s, e, n] = b;
  const pad = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    if (span < minSpan) { const m = (lo + hi) / 2; return [m - minSpan / 2, m + minSpan / 2]; }
    const m = span * 0.08; return [lo - m, hi + m];
  };
  [w, e] = pad(w, e); [s, n] = pad(s, n);
  return [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)];
}
