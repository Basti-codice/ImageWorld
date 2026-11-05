// HEIC/HEIF decoding with libheif-js (WebAssembly) → resized webp. Heavy (synchronous wasm), so it normally runs in
// heic-worker.ts; the same function is used in-process as a fallback and in tests.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { ThumbSize } from '@shared/types';

type LibHeif = {
  HeifDecoder: new () => { decode(buf: Uint8Array | Buffer): HeifImage[] };
};
interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: { data: Uint8ClampedArray; width: number; height: number } | null) => void): void;
  free?: () => void;
}

let lib: LibHeif | null = null;
async function getLib(): Promise<LibHeif> {
  if (!lib) {
    const m = (await import('libheif-js/wasm-bundle.js')) as unknown as { default?: LibHeif } & LibHeif;
    lib = (m.default && (m.default as LibHeif).HeifDecoder ? m.default : m) as LibHeif;
  }
  return lib;
}

export async function decodeHeifToRaw(file: string): Promise<{ data: Buffer; width: number; height: number }> {
  const heif = await getLib();
  const buf = await readFile(file);
  const decoder = new heif.HeifDecoder();
  const images = decoder.decode(buf);
  if (!images?.length) throw new Error('HEIF: no image');
  const image = images[0];
  try {
    const width = image.get_width();
    const height = image.get_height();
    const out = await new Promise<{ data: Uint8ClampedArray }>((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d) => (d ? resolve(d) : reject(new Error('HEIF decode failed'))));
    });
    return { data: Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength), width, height };
  } finally {
    for (const i of images) { try { i.free?.(); } catch { /* ignore */ } }
  }
}

export async function renderHeic(file: string, size: ThumbSize): Promise<Buffer> {
  const { data, width, height } = await decodeHeifToRaw(file);
  // libheif applies irot/imir transforms itself → pixels are already upright, no auto-orient here
  const img = sharp(data, { raw: { width, height, channels: 4 } });
  const cover = size !== 1600;
  return img
    .resize(size, size, cover ? { fit: 'cover' } : { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: cover ? 80 : 82, effort: 3 })
    .toBuffer();
}
