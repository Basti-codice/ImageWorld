import { Cloud, HardDrive, Network } from 'lucide-react';
import type { Source, SourceKind, ScanProgress } from '@shared/types';
import { useUi } from '@/state/ui';
import { t, tn, currentLocale } from '@/i18n';

/** Kind icon used by sidebar, sync popover, settings and onboarding. */
export function SourceIcon({ kind, size = 16 }: { kind: SourceKind; size?: number }) {
  const Icon = kind === 'onedrive' ? Cloud : kind === 'network' ? Network : HardDrive;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

/** Opens the native folder picker and reports the outcome. */
export async function pickFolders(): Promise<Source[]> {
  try {
    const added = await window.api.sources.pickAndAdd();
    if (added.length) useUi.getState().toast(tn('sources.added', added.length), { tone: 'success' });
    return added;
  } catch (e) {
    useUi.getState().toast(t('sources.addFailed'), { tone: 'danger' });
    console.error(e);
    return [];
  }
}

export async function addFolderPath(path: string): Promise<Source | null> {
  try {
    const s = await window.api.sources.add(path);
    useUi.getState().toast(t('sources.addedOne', { name: s.label }), { tone: 'success' });
    return s;
  } catch (e) {
    useUi.getState().toast(t('sources.addFailed'), { tone: 'danger' });
    console.error(e);
    return null;
  }
}

/** Removes a source and clears a filter that would now point at nothing. */
export async function removeSource(s: Source) {
  const ui = useUi.getState();
  if (ui.filters.sourceIds.includes(s.id)) ui.setFilters({ sourceIds: ui.filters.sourceIds.filter((x) => x !== s.id) });
  await window.api.sources.remove(s.id);
  ui.toast(t('sources.removed', { name: s.label }));
}

/** Reveals a source in the file explorer – the contract only offers it per photo, so the first photo of the source is used. */
export async function revealSource(s: Source, firstPhotoId: string | undefined) {
  if (!firstPhotoId) { useUi.getState().toast(t('sources.noFiles')); return; }
  await window.api.shell.showInFolder(firstPhotoId);
}

/** 0..1 of an in-flight scan of one source (undefined = unknown/indeterminate). */
export function progressRatio(p: ScanProgress | undefined): number | undefined {
  if (!p) return undefined;
  if (p.phase === 'discovering' || p.total <= 0) return undefined;
  return Math.min(1, p.done / p.total);
}

export function phaseLabel(p: ScanProgress): string {
  return t(`sync.phase.${p.phase}`);
}

export function relativeTime(ms: number | null): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(0, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
