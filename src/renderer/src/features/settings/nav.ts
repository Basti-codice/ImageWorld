import { create } from 'zustand';
import { useUi } from '@/state/ui';

export type SettingsTab = 'general' | 'map' | 'sources' | 'storage' | 'shortcuts' | 'about';

export const useSettingsNav = create<{ tab: SettingsTab; setTab(t: SettingsTab): void }>((set) => ({ tab: 'general', setTab: (tab) => set({ tab }) }));

/** Opens the settings dialog, optionally on a specific tab. */
export function openSettings(tab?: SettingsTab) {
  if (tab) useSettingsNav.getState().setTab(tab);
  useUi.getState().setSettingsOpen(true);
}
