import type { Settings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

const THEMES = ['system', 'dark', 'light'];
const LANGS = ['system', 'de', 'en'];
const STYLES = ['dark', 'light', 'satellite', 'voyager'];
const PROJ = ['mercator', 'globe'];

/** keeps only known keys with the right type */
export function sanitizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  const rec = patch as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!(key in rec)) continue;
    const v = rec[key];
    const def = DEFAULT_SETTINGS[key];
    if (typeof v !== typeof def) continue;
    if (key === 'theme' && !THEMES.includes(v as string)) continue;
    if (key === 'language' && !LANGS.includes(v as string)) continue;
    if (key === 'mapStyle' && !STYLES.includes(v as string)) continue;
    if (key === 'mapProjection' && !PROJ.includes(v as string)) continue;
    if (key === 'thumbCacheMB') { const n = Number(v); if (!Number.isFinite(n)) continue; out[key] = Math.max(64, Math.min(1_000_000, Math.round(n))); continue; }
    out[key] = v;
  }
  return out as Partial<Settings>;
}
