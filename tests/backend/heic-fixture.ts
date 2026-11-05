// Builds a minimal but valid HEIC file (HEVC still image in a HEIF container) using the system ffmpeg (libx265).
// Only used by tests – the app decodes HEIC with libheif-js.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(body.length + 8, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
const fullBox = (type: string, version: number, flags: number, ...p: Buffer[]) => box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...p);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

function splitNals(annexB: Buffer): Buffer[] {
  const nals: Buffer[] = [];
  let i = 0;
  const starts: number[] = [];
  while (i + 3 <= annexB.length) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) { starts.push(i + 3); i += 3; } else i++;
  }
  starts.forEach((s, k) => {
    let e = k + 1 < starts.length ? starts[k + 1] - 3 : annexB.length;
    while (e > s && annexB[e - 1] === 0) e--; // trailing zero bytes belong to the next start code
    nals.push(annexB.subarray(s, e));
  });
  return nals;
}

/** @param rotation irot angle in 90° steps counter-clockwise (0..3) */
export function makeHeic(file: string, width = 256, height = 192, rotation = 0): void {
  const bitstream = execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=1:duration=1`,
    '-frames:v', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx265', '-x265-params', 'log-level=none:keyint=1:repeat-headers=1', '-f', 'hevc', 'pipe:1',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const nals = splitNals(bitstream);
  const type = (n: Buffer) => (n[0] >> 1) & 0x3f;
  const vps = nals.find((n) => type(n) === 32)!;
  const sps = nals.find((n) => type(n) === 33)!;
  const pps = nals.find((n) => type(n) === 34)!;
  const slices = nals.filter((n) => type(n) < 32);
  if (!vps || !sps || !pps || !slices.length) throw new Error('x265 produced no parameter sets');

  const ptl = sps.subarray(3, 3 + 12); // profile_tier_level (general) after NAL header + vps/sublayer byte
  const hvcC = box('hvcC', Buffer.concat([
    Buffer.from([1]), ptl.subarray(0, 1), ptl.subarray(1, 5), ptl.subarray(5, 11), ptl.subarray(11, 12),
    Buffer.from([0xf0, 0x00, 0xfc, 0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 3]),
    ...[[32, vps], [33, sps], [34, pps]].flatMap(([t, n]) => [Buffer.from([0x80 | (t as number)]), u16(1), u16((n as Buffer).length), n as Buffer]),
  ]));
  const ispe = fullBox('ispe', 0, 0, u32(width), u32(height));
  const props = [hvcC, ispe];
  const assoc = [0x81, 0x02];
  if (rotation) { props.push(box('irot', Buffer.from([rotation & 3]))); assoc.push(0x83); }
  const ipco = box('ipco', ...props);
  const ipma = fullBox('ipma', 0, 0, u32(1), u16(1), Buffer.from([assoc.length, ...assoc]));
  const iprp = box('iprp', ipco, ipma);

  const data = Buffer.concat(slices.flatMap((s) => [u32(s.length), s]));
  const ftyp = box('ftyp', Buffer.from('heic'), u32(0), Buffer.from('mif1heic'));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), Buffer.from('pict'), Buffer.alloc(12), Buffer.from([0]));
  const pitm = fullBox('pitm', 0, 0, u16(1));
  const iinf = fullBox('iinf', 0, 0, u16(1), fullBox('infe', 2, 0, u16(1), u16(0), Buffer.from('hvc1'), Buffer.from([0])));
  const ilocFor = (offset: number) => fullBox('iloc', 0, 0, Buffer.from([0x44, 0x00]), u16(1), u16(1), u16(0), u16(1), u32(offset), u32(data.length));
  const metaSize = (iloc: Buffer) => box('meta', Buffer.from([0, 0, 0, 0]), hdlr, pitm, iloc, iinf, iprp).length;
  const mdatOffset = ftyp.length + metaSize(ilocFor(0)) + 8;
  const meta = box('meta', Buffer.from([0, 0, 0, 0]), hdlr, pitm, ilocFor(mdatOffset), iinf, iprp);
  writeFileSync(file, Buffer.concat([ftyp, meta, box('mdat', data)]));
}
