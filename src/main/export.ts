// Album export: copies original files (never touches the sources) into a folder, collision-safe names.
import { constants, promises as fsp } from 'node:fs';
import { extname, join, parse } from 'node:path';
import type { Album, ExportResult, Photo } from '@shared/types';

export function pointInPolygon(lon: number, lat: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Photos that belong to the album (live area albums are evaluated against the library). */
export function albumPhotos(album: Album, all: Photo[], get: (id: string) => Photo | undefined): Photo[] {
  if (album.live && album.area) {
    const { polygon, from, to } = album.area;
    return all.filter((p) =>
      p.lat != null && p.lon != null &&
      (from === undefined || p.sortTime >= from) && (to === undefined || p.sortTime <= to) &&
      pointInPolygon(p.lon, p.lat, polygon));
  }
  return album.photoIds.map((id) => get(id)).filter((p): p is Photo => !!p);
}

const sanitize = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim() || 'Album';

export async function uniqueFolder(base: string, name: string): Promise<string> {
  const n = sanitize(name);
  for (let i = 0; i < 1000; i++) {
    const dir = join(base, i === 0 ? n : `${n} (${i + 1})`);
    try {
      await fsp.mkdir(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('cannot create export folder');
}

export async function copyCollisionSafe(src: string, dir: string): Promise<string> {
  const { name } = parse(src);
  const ext = extname(src);
  for (let i = 0; i < 10_000; i++) {
    const target = join(dir, i === 0 ? `${name}${ext}` : `${name} (${i + 1})${ext}`);
    try {
      await fsp.copyFile(src, target, constants.COPYFILE_EXCL);
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('no free file name');
}

export async function exportPhotos(photos: Photo[], baseDir: string, albumName: string): Promise<ExportResult> {
  const dir = await uniqueFolder(baseDir, albumName);
  let copied = 0;
  let failed = 0;
  for (const p of photos) {
    try {
      await copyCollisionSafe(p.path, dir);
      copied++;
    } catch {
      failed++;
    }
  }
  return { copied, failed, folder: dir };
}
