import { currentLocale } from '@/i18n';

export const fmtNumber = (n: number) => new Intl.NumberFormat(currentLocale()).format(n);
export const fmtDate = (ms: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Intl.DateTimeFormat(currentLocale(), { timeZone: 'UTC', ...opts }).format(ms); // takenAt is stored as "local-as-UTC"
export const fmtMonthYear = (ms: number) => fmtDate(ms, { month: 'long', year: 'numeric' });
export const fmtTime = (ms: number) => fmtDate(ms, { hour: '2-digit', minute: '2-digit' });
export const fmtBytes = (b: number) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
export const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
export const fmtCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
/** Flag emoji from ISO country code (Windows renders these as letters – prefer text + CountryBadge for UI). */
export const flagEmoji = (cc: string) => cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
