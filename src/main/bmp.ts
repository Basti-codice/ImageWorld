// Minimal BMP decoder (libvips in the prebuilt sharp has no BMP loader). Supports uncompressed 8/24/32 bit.
export function decodeBmp(buf: Buffer): { data: Buffer; width: number; height: number } {
  if (buf.length < 54 || buf.toString('latin1', 0, 2) !== 'BM') throw new Error('not a BMP');
  const dataOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  let height = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0 || width * height > 400_000_000) throw new Error('bad BMP size');
  if (compression !== 0 && compression !== 3) throw new Error('unsupported BMP compression');
  const out = Buffer.alloc(width * height * 4);
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  let palette: Buffer | null = null;
  if (bpp <= 8) {
    const colors = buf.readUInt32LE(46) || 1 << bpp;
    palette = buf.subarray(14 + dibSize, 14 + dibSize + colors * 4);
  }
  for (let y = 0; y < height; y++) {
    const srcRow = dataOffset + (topDown ? y : height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 24) {
        const s = srcRow + x * 3;
        b = buf[s]; g = buf[s + 1]; r = buf[s + 2];
      } else if (bpp === 32) {
        const s = srcRow + x * 4;
        b = buf[s]; g = buf[s + 1]; r = buf[s + 2]; a = 255; // alpha in BI_RGB BMPs is usually unused
      } else if (bpp === 8 && palette) {
        const idx = buf[srcRow + x] * 4;
        b = palette[idx]; g = palette[idx + 1]; r = palette[idx + 2];
      } else throw new Error(`unsupported BMP depth ${bpp}`);
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { data: out, width, height };
}
