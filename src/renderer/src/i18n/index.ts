import { create } from 'zustand';
import type { Language } from '@shared/types';
import { shell } from './messages/shell';
import { map } from '@/features/map/i18n';
import { photos } from '@/features/photos/i18n';
import { timeline } from '@/features/timeline/i18n';
import { search } from '@/features/search/i18n';
import { viewer } from '@/features/viewer/i18n';
import { albums } from '@/features/albums/i18n';
import { insights } from '@/features/insights/i18n';
import { settings } from '@/features/settings/i18n';
import { onboarding } from '@/features/onboarding/i18n';

/** Each feature owns a `i18n.ts` exporting { de: {...}, en: {...} } with keys prefixed by the feature name, e.g. "map.heatmap". */
export type Dict = Record<string, string>;
export interface Bundle { de: Dict; en: Dict }

const bundles: Bundle[] = [shell, map, photos, timeline, search, viewer, albums, insights, settings, onboarding];
const dict: Record<'de' | 'en', Dict> = { de: {}, en: {} };
for (const b of bundles) { Object.assign(dict.de, b.de); Object.assign(dict.en, b.en); }

const systemLang = (): 'de' | 'en' => (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';

interface LangState { lang: 'de' | 'en'; setLanguage(l: Language): void }
export const useLang = create<LangState>((set) => ({
  lang: systemLang(),
  setLanguage: (l) => set({ lang: l === 'system' ? systemLang() : l }),
}));

export const currentLocale = () => (useLang.getState().lang === 'de' ? 'de-DE' : 'en-GB');

/** Translate. `{name}` placeholders are replaced from params. `{n, one|other}` plural: use tn(). */
export function translate(lang: 'de' | 'en', key: string, params?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
/** Non-reactive translate (event handlers, toasts). */
export const t = (key: string, params?: Record<string, string | number>) => translate(useLang.getState().lang, key, params);
/** Reactive hook: re-renders when the language changes. */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
}
/** Plural helper: keys `<key>.one` / `<key>.other`, `{n}` is injected. */
export function tn(key: string, n: number, params?: Record<string, string | number>) {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n: new Intl.NumberFormat(currentLocale()).format(n), ...params });
}
