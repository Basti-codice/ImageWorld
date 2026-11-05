// Metadata extraction (exiftool-vendored) + pure parsing helpers (unit tested without exiftool).
import { ExifTool } from 'exiftool-vendored';
import { cpus } from 'node:os';
import { basename } from 'node:path';
import type { MediaKind } from '@shared/types';
import { HEIF_EXT, RAW_EXT, VIDEO_EXT, warn } from './util';

export interface ParsedMeta {
  takenAt: number | null;
  width: number;
  height: number;
  duration?: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  camera?: string;
  lens?: string;
  iso?: number;
  aperture?: number;
  shutter?: string;
  focalLength?: number;
}

// ---------------------------------------------------------------------------------------------
// exiftool singleton
// ---------------------------------------------------------------------------------------------

let shared: ExifTool | null = null;

export function getExifTool(): ExifTool {
  if (!shared) {
    shared = new ExifTool({
      taskTimeoutMillis: 45_000,
      // exiftool-vendored spawns one perl/exe process per slot; reading is IO bound so allow a few
      maxProcs: Math.max(2, Math.min(4, Math.floor(cpus().length / 2))),
      maxTasksPerProcess: 500,
      // exiftool-vendored resolves app.asar -> app.asar.unpacked itself for the bundled binaries
    });
  }
  return shared;
}

export async function shutdownExifTool(): Promise<void> {
  const e = shared;
  shared = null;
  if (!e) return;
  try {
    await Promise.race([e.end(true), new Promise((r) => setTimeout(r, 4000))]);
  } catch (err) {
    warn('exiftool shutdown', err);
  }
}

const TAGS = [
  'DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'CreationDate', 'TrackCreateDate', 'SubSecDateTimeOriginal',
  'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'SourceImageWidth', 'SourceImageHeight',
  'Orientation', 'Rotation',
  'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef', 'GPSCoordinates', 'GPSPosition',
  'Make', 'Model', 'LensModel', 'LensID', 'Lens', 'ISO', 'FNumber', 'Aperture', 'ExposureTime', 'FocalLength',
  'Duration', 'MediaDuration',
];

/** Reads and parses everything we need for one file. Never throws for unreadable metadata – returns what it can. */
export async function readMetadata(file: string, ext: string, kind: MediaKind, mtime: number): Promise<ParsedMeta> {
  const args = ['-n', '-m', ...TAGS.map((t) => `-${t}`)];
  // -fast2 skips maker notes / trailers: ok for jpeg; QuickTime & RAW need the full structure
  if (ext === 'jpg' || ext === 'jpeg') args.unshift('-fast2');
  const tags = (await getExifTool().readRaw(file, args)) as unknown as Record<string, unknown>;
  return parseTags(tags, { ext, kind, name: basename(file), mtime });
}

// ---------------------------------------------------------------------------------------------
// Pure parsing
// ---------------------------------------------------------------------------------------------

type Tags = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (Array.isArray(v)) return num(v[0]);
  return undefined;
};
const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return str(v[0]);
  return undefined;
};

/**
 * "2023:05:01 14:30:00[.123][+02:00]" → epoch ms with the wall-clock time interpreted as UTC
 * (EXIF has no timezone; types.ts defines takenAt as local-as-UTC). Offsets are deliberately ignored.
 */
export function parseExifDate(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:[.,](\d+))?)?/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, sec, frac] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0', m[7]].map((x, i) => (i === 6 ? x : Number(x)));
  if ((y as number) < 1900 || (mo as number) < 1 || (mo as number) > 12 || (d as number) < 1 || (d as number) > 31) return null;
  const ms = frac ? Math.round(Number('0.' + frac) * 1000) : 0;
  const t = Date.UTC(y as number, (mo as number) - 1, d as number, h as number, mi as number, sec as number, ms);
  return Number.isFinite(t) ? t : null;
}

const FILENAME_DATE =
  /(?<![0-9])((?:19[89]\d|20\d{2}))[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?:[-_ T.]|\s+at\s+)*([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?(?![0-9])/i;

/** IMG_20230501_143000.jpg, PXL_20230501_143000123.jpg, 2023-05-01 14.30.00.jpg, WhatsApp Image 2023-05-01 at 14.30.00.jpeg … */
export function dateFromFilename(name: string, now = Date.now()): number | null {
  const m = FILENAME_DATE.exec(name);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
  if (!Number.isFinite(t) || t > now + 2 * 86400_000) return null;
  // reject impossible calendar dates (e.g. 2023-02-31 rolls over)
  const d = new Date(t);
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return t;
}

export function validGps(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const la = num(lat);
  const lo = num(lon);
  if (la === undefined || lo === undefined) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  if (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6) return null; // null island
  return { lat: la, lon: lo };
}

/** ISO 6709 "+48.1370+011.5750+520.000/" or plain "48.137 11.575 520" */
export function parseCoordinateString(v: unknown): { lat: number; lon: number; alt?: number } | null {
  const s = str(v);
  if (!s) return null;
  const iso = /^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(s);
  let parts: number[] | null = null;
  if (iso) parts = [Number(iso[1]), Number(iso[2]), iso[3] !== undefined ? Number(iso[3]) : NaN];
  else {
    const m = s.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (m.length >= 2) parts = [m[0], m[1], m[2] ?? NaN];
  }
  if (!parts) return null;
  const g = validGps(parts[0], parts[1]);
  if (!g) return null;
  return { ...g, alt: Number.isFinite(parts[2]) ? parts[2] : undefined };
}

export function formatShutter(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !(seconds > 0)) return undefined;
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10}s`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

const MAKE_NOISE = /\b(corporation|corp\.?|company|co\.?,?\s*ltd\.?|ltd\.?|inc\.?|imaging|electronics|optical|group|gmbh)\b/gi;

/** "Apple" + "iPhone 15 Pro" → "Apple iPhone 15 Pro"; "NIKON CORPORATION" + "NIKON D850" → "NIKON D850" */
export function combineCamera(make?: string, model?: string): string | undefined {
  const mk = make?.replace(MAKE_NOISE, '').replace(/[\s,.]+$/g, '').replace(/\s+/g, ' ').trim();
  const md = model?.replace(/\s+/g, ' ').trim();
  if (!md) return mk || undefined;
  if (!mk) return md;
  const first = mk.split(' ')[0].toLowerCase();
  if (md.toLowerCase().startsWith(mk.toLowerCase()) || md.toLowerCase().startsWith(first)) return md;
  const nice = mk === mk.toLowerCase() ? mk[0].toUpperCase() + mk.slice(1) : mk;
  return `${nice} ${md}`;
}

function orientationSwap(o: number | undefined, rotation: number | undefined, ext: string): boolean {
  if (o !== undefined && o >= 1 && o <= 8) return o >= 5;
  if (rotation !== undefined) {
    // HEIF `irot` is reported by exiftool as a quarter-turn count (0..3); QuickTime video rotation is in degrees
    if (HEIF_EXT.has(ext)) return rotation === 1 || rotation === 3;
    const r = ((Math.round(rotation) % 360) + 360) % 360;
    return r === 90 || r === 270;
  }
  return false;
}

export function parseTags(t: Tags, ctx: { ext: string; kind: MediaKind; name: string; mtime: number }): ParsedMeta {
  const isVideo = ctx.kind === 'video' || VIDEO_EXT.has(ctx.ext);
  const isRaw = RAW_EXT.has(ctx.ext);

  // ---- time
  const order = isVideo
    ? ['CreationDate', 'DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate']
    : ['DateTimeOriginal', 'SubSecDateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'CreationDate'];
  let takenAt: number | null = null;
  for (const k of order) {
    takenAt = parseExifDate(t[k]);
    if (takenAt !== null) break;
  }
  if (takenAt === null) takenAt = dateFromFilename(ctx.name);

  // ---- size (after orientation)
  let w = num(t.ImageWidth);
  let h = num(t.ImageHeight);
  const ew = num(t.ExifImageWidth) ?? num(t.SourceImageWidth);
  const eh = num(t.ExifImageHeight) ?? num(t.SourceImageHeight);
  // RAW IFD0 usually describes the embedded thumbnail – prefer the EXIF full-size values there
  if (isRaw && ew && eh) { w = ew; h = eh; }
  if (!w || !h) { w = ew ?? w; h = eh ?? h; }
  w = w ?? 0;
  h = h ?? 0;
  if (orientationSwap(num(t.Orientation), num(t.Rotation), ctx.ext)) [w, h] = [h, w];

  // ---- gps
  let gps: { lat: number; lon: number } | null = null;
  let alt: number | null = null;
  let la = num(t.GPSLatitude);
  let lo = num(t.GPSLongitude);
  if (la !== undefined && lo !== undefined) {
    if (la > 0 && str(t.GPSLatitudeRef)?.toUpperCase().startsWith('S')) la = -la;
    if (lo > 0 && str(t.GPSLongitudeRef)?.toUpperCase().startsWith('W')) lo = -lo;
    gps = validGps(la, lo);
    if (gps) {
      let a = num(t.GPSAltitude);
      if (a !== undefined && a > 0 && num(t.GPSAltitudeRef) === 1) a = -a;
      alt = a ?? null;
    }
  }
  if (!gps) {
    for (const k of ['GPSCoordinates', 'GPSPosition']) {
      const c = parseCoordinateString(t[k]);
      if (c) { gps = { lat: c.lat, lon: c.lon }; alt = c.alt ?? null; break; }
    }
  }

  // ---- camera
  const lens = str(t.LensModel) ?? str(t.Lens) ?? str(t.LensID);
  const exposure = num(t.ExposureTime);
  const iso = num(t.ISO);
  const meta: ParsedMeta = {
    takenAt,
    width: Math.round(w),
    height: Math.round(h),
    lat: gps?.lat ?? null,
    lon: gps?.lon ?? null,
    alt: gps ? alt : null,
  };
  const camera = combineCamera(str(t.Make), str(t.Model));
  if (camera) meta.camera = camera;
  if (lens) meta.lens = lens;
  if (iso !== undefined && iso > 0) meta.iso = Math.round(iso);
  const ap = num(t.FNumber) ?? num(t.Aperture);
  if (ap !== undefined && ap > 0) meta.aperture = Math.round(ap * 10) / 10;
  const sh = formatShutter(exposure);
  if (sh) meta.shutter = sh;
  const fl = num(t.FocalLength);
  if (fl !== undefined && fl > 0) meta.focalLength = Math.round(fl * 10) / 10;
  if (isVideo) {
    const d = num(t.Duration) ?? num(t.MediaDuration);
    if (d !== undefined && d >= 0) meta.duration = Math.round(d * 100) / 100;
  }
  return meta;
}
