// iw-thumb://<photoId>/<256|512|1600>  and  iw-file://<photoId>  (original file, HTTP Range supported).
import { createReadStream, promises as fsp } from 'node:fs';
import { Readable } from 'node:stream';
import { FILE_PROTOCOL, THUMB_PROTOCOL, type ThumbSize } from '@shared/types';
import type { ThumbService } from './thumbs';
import { isThumbSize } from './thumbs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp',
};

export const contentTypeFor = (ext: string) => MIME[ext.toLowerCase()] ?? 'application/octet-stream';

/** privileges must be registered before app 'ready' */
export function privilegedSchemes() {
  const privileges = { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true };
  return [
    { scheme: THUMB_PROTOCOL, privileges },
    { scheme: FILE_PROTOCOL, privileges },
  ];
}

export function parseThumbUrl(url: string): { id: string; size: ThumbSize } | null {
  try {
    const u = new URL(url);
    const size = Number(u.pathname.replace(/^\/+/, '').split('/')[0] || '256');
    if (!isThumbSize(size)) return null;
    return { id: decodeURIComponent(u.hostname), size };
  } catch {
    return null;
  }
}

export function parseFileUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).hostname) || null;
  } catch {
    return null;
  }
}

export interface ByteRange { start: number; end: number }

/** Parses a single-range `Range: bytes=…` header. null = no/unsupported header, 'invalid' = unsatisfiable. */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.split(',')[0].trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start <= end) || start >= size) return 'invalid';
  return { start, end };
}

/** Serves a file with Range support (needed for <video> seeking). */
export async function serveFile(request: Request, path: string, ext: string): Promise<Response> {
  let st;
  try { st = await fsp.stat(path); } catch { return new Response('Not found', { status: 404, headers: CORS }); }
  if (!st.isFile()) return new Response('Not found', { status: 404, headers: CORS });
  const size = st.size;
  const base: Record<string, string> = {
    ...CORS, 'Content-Type': contentTypeFor(ext), 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'private, max-age=300',
  };
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  const isHead = request.method === 'HEAD';
  if (range) {
    const len = range.end - range.start + 1;
    const headers = { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(len) };
    if (isHead) return new Response(null, { status: 206, headers });
    return new Response(Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as unknown as ReadableStream, { status: 206, headers });
  }
  const headers = { ...base, 'Content-Length': String(size) };
  if (isHead || size === 0) return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, { status: 200, headers });
}

export interface ProtocolDeps {
  thumbs: ThumbService;
  getPhoto: (id: string) => { path: string; ext: string } | undefined;
}

export function thumbHandler(deps: ProtocolDeps) {
  return async (request: Request): Promise<Response> => {
    const parsed = parseThumbUrl(request.url);
    if (!parsed) return new Response('Bad request', { status: 400, headers: CORS });
    const { buf, placeholder } = await deps.thumbs.get(parsed.id, parsed.size, { signal: request.signal });
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'image/webp',
        'Content-Length': String(buf.length),
        // placeholders must not stick in Chromium's cache – the real thumbnail may arrive a moment later
        'Cache-Control': placeholder ? 'no-store' : 'private, max-age=600',
      },
    });
  };
}

export function fileHandler(deps: ProtocolDeps) {
  return async (request: Request): Promise<Response> => {
    const id = parseFileUrl(request.url);
    const photo = id ? deps.getPhoto(id) : undefined;
    if (!photo) return new Response('Not found', { status: 404, headers: CORS });
    return serveFile(request, photo.path, photo.ext);
  };
}
