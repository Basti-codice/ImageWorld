// Generates the app icons from resources/icon.svg (fallback: scripts/icon-fallback.svg).
//   build/icon.ico            multi-size ICO (16–256, PNG-compressed entries) – electron-builder / NSIS
//   build/icon.png            1024×1024
//   build/icon-512.png        512×512
//   resources/icon.png        512×512 (window icon in dev / Linux)
//   build/installerSidebar.bmp / uninstallerSidebar.bmp   164×314 (NSIS wizard)
//   build/installerHeader.bmp                              150×57  (NSIS assisted-installer header)
// Usage: node scripts/make-icons.mjs        (no extra npm dependencies: sharp + own ICO/BMP writers)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const resDir = join(root, 'resources');
mkdirSync(buildDir, { recursive: true });
mkdirSync(resDir, { recursive: true });

const svgPath = [join(resDir, 'icon.svg'), join(root, 'scripts', 'icon-fallback.svg')].find(existsSync);
console.log('icon source:', svgPath.replace(root, '.'));
const svg = readFileSync(svgPath);

/** Render the SVG crisply at an exact square size (density scaled so small sizes stay sharp). */
async function png(size) {
  const meta = await sharp(svg).metadata();
  const density = Math.max(72, Math.ceil((72 * size) / Math.max(meta.width ?? 32, meta.height ?? 32)) * 2);
  return sharp(svg, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** ICO container with PNG-compressed entries (Vista+ / all supported Windows versions). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width  (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height (0 = 256)
    dir.writeUInt8(0, o + 2); // palette colours
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

/** 24-bit BMP (BITMAPINFOHEADER, bottom-up, rows padded to 4 bytes) from raw RGB. NSIS needs BMP3. */
function buildBmp24(rgb, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * h);
  for (let y = 0; y < h; y++) {
    const dst = (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3;
      pixels[dst + x * 3] = rgb[s + 2]; // B
      pixels[dst + x * 3 + 1] = rgb[s + 1]; // G
      pixels[dst + x * 3 + 2] = rgb[s]; // R
    }
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0, 'ascii');
  head.writeUInt32LE(54 + pixels.length, 2);
  head.writeUInt32LE(54, 10); // pixel data offset
  head.writeUInt32LE(40, 14); // DIB header size
  head.writeInt32LE(w, 18);
  head.writeInt32LE(h, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(0, 30); // BI_RGB
  head.writeUInt32LE(pixels.length, 34);
  head.writeInt32LE(2835, 38);
  head.writeInt32LE(2835, 42);
  return Buffer.concat([head, pixels]);
}

async function bmp(w, h, svgMarkup) {
  const raw = await sharp(Buffer.from(svgMarkup)).flatten({ background: '#0c0e13' }).removeAlpha().raw().toBuffer();
  return buildBmp24(raw, w, h);
}

// --- icons -----------------------------------------------------------------
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];
for (const size of icoSizes) icoImages.push({ size, data: await png(size) });
writeFileSync(join(buildDir, 'icon.ico'), buildIco(icoImages));
const p1024 = await png(1024);
const p512 = await png(512);
writeFileSync(join(buildDir, 'icon.png'), p1024);
writeFileSync(join(buildDir, 'icon-512.png'), p512);
writeFileSync(join(resDir, 'icon.png'), p512);

// --- NSIS wizard bitmaps ----------------------------------------------------
const logo = async (size) => `data:image/png;base64,${(await png(size)).toString('base64')}`;
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="#0c0e13"/>
  <rect x="163" width="1" height="314" fill="#242a36"/>
  <image x="34" y="40" width="96" height="96" xlink:href="${await logo(192)}"/>
  <text x="82" y="176" text-anchor="middle" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="19" font-weight="600" fill="#e8ebf2">ImageWorld</text>
  <text x="82" y="198" text-anchor="middle" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="10.5" fill="#8a93a6">Deine Fotos. Die ganze Welt.</text>
</svg>`;
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#0c0e13"/>
  <image x="102" y="9" width="39" height="39" xlink:href="${await logo(78)}"/>
</svg>`;
const sidebar = await bmp(164, 314, sidebarSvg);
writeFileSync(join(buildDir, 'installerSidebar.bmp'), sidebar);
writeFileSync(join(buildDir, 'uninstallerSidebar.bmp'), sidebar);
writeFileSync(join(buildDir, 'installerHeader.bmp'), await bmp(150, 57, headerSvg));

console.log('wrote build/icon.ico (%s), build/icon.png, build/icon-512.png, resources/icon.png, NSIS bitmaps', icoSizes.join('/'));
