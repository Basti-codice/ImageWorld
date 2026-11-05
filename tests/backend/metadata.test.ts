import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combineCamera, dateFromFilename, formatShutter, parseCoordinateString, parseExifDate, parseTags, readMetadata, validGps } from '../../src/main/metadata';
import { buildFixtures, type Fixtures } from './fixtures';

const ctx = (ext = 'jpg', kind: 'photo' | 'video' = 'photo', name = 'a.jpg') => ({ ext, kind, name, mtime: 1_700_000_000_000 });

describe('metadata parsing (pure)', () => {
  it('parses EXIF dates as local-as-UTC and ignores offsets', () => {
    expect(parseExifDate('2023:05:01 14:30:00')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(parseExifDate('2023:05:01 14:30:00+02:00')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(parseExifDate('2023:05:01 14:30:00.250')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0, 250));
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('garbage')).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
  });

  it('extracts dates from file names', () => {
    expect(dateFromFilename('IMG_20230501_143000.jpg')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(dateFromFilename('PXL_20210704_101500123.jpg')).toBe(Date.UTC(2021, 6, 4, 10, 15, 0));
    expect(dateFromFilename('2023-05-01 14.30.00.jpg')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(dateFromFilename('WhatsApp Image 2023-05-01 at 14.30.00.jpeg')).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(dateFromFilename('Urlaub 2019-07-04.png')).toBe(Date.UTC(2019, 6, 4));
    expect(dateFromFilename('IMG_1234.jpg')).toBeNull();
    expect(dateFromFilename('scan_99999999.jpg')).toBeNull();
    expect(dateFromFilename('IMG_20231345_000000.jpg')).toBeNull(); // month 13
    expect(dateFromFilename('IMG_20230231.jpg')).toBeNull(); // Feb 31
  });

  it('validates GPS (range, null island)', () => {
    expect(validGps(48.1, 11.5)).toEqual({ lat: 48.1, lon: 11.5 });
    expect(validGps(0, 0)).toBeNull();
    expect(validGps(91, 0)).toBeNull();
    expect(validGps(10, 181)).toBeNull();
    expect(validGps(undefined, 5)).toBeNull();
    expect(validGps('x', 5)).toBeNull();
    expect(validGps(0, 12)).toEqual({ lat: 0, lon: 12 }); // equator is fine, only (0,0) is rejected
  });

  it('parses QuickTime / ISO 6709 coordinates', () => {
    expect(parseCoordinateString('+48.1370+011.5750+520.000/')).toEqual({ lat: 48.137, lon: 11.575, alt: 520 });
    expect(parseCoordinateString('-22.9068-043.1729/')).toEqual({ lat: -22.9068, lon: -43.1729, alt: undefined });
    expect(parseCoordinateString('35.67619 139.65030')).toEqual({ lat: 35.67619, lon: 139.6503, alt: undefined });
    expect(parseCoordinateString('+00.0000+000.0000/')).toBeNull();
  });

  it('combines make and model without duplicates', () => {
    expect(combineCamera('Apple', 'iPhone 15 Pro')).toBe('Apple iPhone 15 Pro');
    expect(combineCamera('Apple', 'Apple iPhone 15 Pro')).toBe('Apple iPhone 15 Pro');
    expect(combineCamera('NIKON CORPORATION', 'NIKON D850')).toBe('NIKON D850');
    expect(combineCamera('Canon', 'Canon EOS R5')).toBe('Canon EOS R5');
    expect(combineCamera('SONY', 'ILCE-7M3')).toBe('SONY ILCE-7M3');
    expect(combineCamera('samsung', 'SM-G991B')).toBe('Samsung SM-G991B');
    expect(combineCamera('OLYMPUS IMAGING CORP.', 'E-M1')).toBe('OLYMPUS E-M1');
    expect(combineCamera(undefined, 'X100V')).toBe('X100V');
    expect(combineCamera('Fujifilm', undefined)).toBe('Fujifilm');
    expect(combineCamera(undefined, undefined)).toBeUndefined();
  });

  it('formats shutter speeds', () => {
    expect(formatShutter(0.004)).toBe('1/250');
    expect(formatShutter(1 / 3)).toBe('1/3');
    expect(formatShutter(2)).toBe('2s');
    expect(formatShutter(0.5)).toBe('1/2');
    expect(formatShutter(0)).toBeUndefined();
  });

  it('swaps dimensions for rotated orientations and rotated videos', () => {
    expect(parseTags({ ImageWidth: 300, ImageHeight: 200, Orientation: 6 }, ctx())).toMatchObject({ width: 200, height: 300 });
    expect(parseTags({ ImageWidth: 300, ImageHeight: 200, Orientation: 1 }, ctx())).toMatchObject({ width: 300, height: 200 });
    expect(parseTags({ ImageWidth: 300, ImageHeight: 200, Orientation: 8 }, ctx())).toMatchObject({ width: 200, height: 300 });
    expect(parseTags({ ImageWidth: 1920, ImageHeight: 1080, Rotation: 90 }, ctx('mp4', 'video', 'a.mp4'))).toMatchObject({ width: 1080, height: 1920 });
    expect(parseTags({ ImageWidth: 1920, ImageHeight: 1080, Rotation: 180 }, ctx('mp4', 'video', 'a.mp4'))).toMatchObject({ width: 1920, height: 1080 });
    // HEIF irot is a quarter-turn count
    expect(parseTags({ ImageWidth: 256, ImageHeight: 192, Rotation: 1 }, ctx('heic'))).toMatchObject({ width: 192, height: 256 });
  });

  it('applies hemisphere refs and falls back to composite coordinates', () => {
    expect(parseTags({ GPSLatitude: 22.9, GPSLatitudeRef: 'S', GPSLongitude: 43.1, GPSLongitudeRef: 'W' }, ctx())).toMatchObject({ lat: -22.9, lon: -43.1 });
    expect(parseTags({ GPSLatitude: -22.9, GPSLatitudeRef: 'S', GPSLongitude: -43.1, GPSLongitudeRef: 'W' }, ctx())).toMatchObject({ lat: -22.9, lon: -43.1 });
    expect(parseTags({ GPSCoordinates: '+35.6762+139.6503+40.0/' }, ctx('mov', 'video', 'a.mov'))).toMatchObject({ lat: 35.6762, lon: 139.6503, alt: 40 });
    expect(parseTags({ GPSLatitude: 0, GPSLongitude: 0 }, ctx())).toMatchObject({ lat: null, lon: null, alt: null });
    expect(parseTags({ GPSLatitude: 10, GPSLongitude: 20, GPSAltitude: 12, GPSAltitudeRef: 1 }, ctx())).toMatchObject({ alt: -12 });
  });

  it('prefers EXIF dates, then filename, never mtime for takenAt', () => {
    expect(parseTags({ DateTimeOriginal: '2020:01:02 03:04:05' }, ctx('jpg', 'photo', 'IMG_20230501.jpg')).takenAt).toBe(Date.UTC(2020, 0, 2, 3, 4, 5));
    expect(parseTags({}, ctx('jpg', 'photo', 'IMG_20230501_101112.jpg')).takenAt).toBe(Date.UTC(2023, 4, 1, 10, 11, 12));
    expect(parseTags({}, ctx('jpg', 'photo', 'plain.jpg')).takenAt).toBeNull();
    expect(parseTags({ CreateDate: '2022:08:09 10:11:12' }, ctx('mp4', 'video', 'v.mp4')).takenAt).toBe(Date.UTC(2022, 7, 9, 10, 11, 12));
  });

  it('raw files prefer EXIF full-size dimensions over the IFD0 thumbnail size', () => {
    expect(parseTags({ ImageWidth: 160, ImageHeight: 120, ExifImageWidth: 6000, ExifImageHeight: 4000 }, ctx('nef'))).toMatchObject({ width: 6000, height: 4000 });
  });
});

describe('metadata from real files (exiftool)', () => {
  let fx: Fixtures;
  beforeAll(async () => { fx = await buildFixtures(); });
  afterAll(async () => { await fx.cleanup(); });

  const read = (rel: string, ext: string, kind: 'photo' | 'video' = 'photo') => readMetadata(fx.dir(...rel.split('/')), ext, kind, 1_700_000_000_000);

  it('reads the full EXIF set', async () => {
    const m = await read('trip/paris.jpg', 'jpg');
    expect(m.takenAt).toBe(Date.UTC(2023, 4, 1, 14, 30, 0));
    expect(m.width).toBe(640);
    expect(m.height).toBe(480);
    expect(m.lat).toBeCloseTo(48.8566, 4);
    expect(m.lon).toBeCloseTo(2.3522, 4);
    expect(m.alt).toBe(35);
    expect(m.camera).toBe('Apple iPhone 15 Pro');
    expect(m.lens).toContain('iPhone 15 Pro back camera');
    expect(m.iso).toBe(125);
    expect(m.aperture).toBe(1.8);
    expect(m.shutter).toBe('1/250');
    expect(m.focalLength).toBe(6.9);
  });

  it('reports dimensions after orientation for the rotated portrait', async () => {
    const m = await read('trip/portrait.jpg', 'jpg');
    expect(m.width).toBe(200);
    expect(m.height).toBe(300);
    expect(m.camera).toBe('NIKON D850');
  });

  it('handles the southern/western hemisphere', async () => {
    const m = await read('trip/rio.jpg', 'jpg');
    expect(m.lat).toBeCloseTo(-22.9068, 3);
    expect(m.lon).toBeCloseTo(-43.1729, 3);
  });

  it('rejects null-island GPS', async () => {
    const m = await read('trip/nullisland.jpg', 'jpg');
    expect(m.lat).toBeNull();
    expect(m.lon).toBeNull();
    expect(m.takenAt).toBe(Date.UTC(2020, 0, 1));
  });

  it('falls back to the file name for the date', async () => {
    const m = await read('trip/IMG_20190704_101500.jpg', 'jpg');
    expect(m.takenAt).toBe(Date.UTC(2019, 6, 4, 10, 15, 0));
    expect(m.lat).toBeNull();
    expect(m.width).toBe(200);
  });

  it('reads PNG metadata', async () => {
    const m = await read('trip/sub/tokyo.png', 'png');
    expect(m.lat).toBeCloseTo(35.6762, 3);
    expect(m.takenAt).toBe(Date.UTC(2022, 0, 2, 3, 4, 5));
    expect(m.width).toBe(200);
  });

  it('reads GPS, duration and size from a video', async () => {
    const m = await read('trip/clip.mp4', 'mp4', 'video');
    expect(m.lat).toBeCloseTo(35.6762, 3);
    expect(m.lon).toBeCloseTo(139.6503, 3);
    expect(m.duration).toBeGreaterThan(1.5);
    expect(m.duration).toBeLessThan(2.5);
    expect(m.width).toBe(320);
    expect(m.height).toBe(240);
    expect(m.takenAt).toBe(Date.UTC(2022, 7, 9, 10, 11, 12));
  });

  it('reads a HEIC with irot (display size swapped)', async () => {
    const m = await read('trip/photo.heic', 'heic');
    expect(m.width).toBe(192);
    expect(m.height).toBe(256);
  });

  it('reads a RAW container (EXIF orientation applied to dimensions)', async () => {
    const m = await read('trip/raw.dng', 'dng');
    expect(m.camera).toBe('Canon EOS R5');
    expect(m.takenAt).toBe(Date.UTC(2021, 6, 8, 9, 10, 11));
    expect(m.width).toBe(600);
    expect(m.height).toBe(800);
  });
});
