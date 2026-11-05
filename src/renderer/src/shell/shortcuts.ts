import { useEffect } from 'react';
import { useUi, type View } from '@/state/ui';
import { useLibrary } from '@/state/library';
import { openSettings } from '@/features/settings/nav';

const VIEWS: View[] = ['map', 'photos', 'albums', 'places', 'insights'];

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  return n.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName) && !['checkbox', 'radio', 'button', 'range'].includes((n as HTMLInputElement).type);
};

/** App-wide keyboard shortcuts (Ctrl+K lives here too). Never fires while typing or while a modal layer is open. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod && key.toLowerCase() === 'k') { e.preventDefault(); ui.setCommandPalette(true); return; }
      if (mod && key === ',') { e.preventDefault(); openSettings(); return; }
      if (mod && key.toLowerCase() === 'b' && !e.shiftKey) {
        if (isTyping(e.target)) return;
        e.preventDefault();
        const s = useLibrary.getState(); void s.setSettings({ sidebarCollapsed: !s.settings.sidebarCollapsed });
        return;
      }
      if (key === 'Escape') {
        if (!ui.viewer && !ui.commandPaletteOpen && !isTyping(e.target) && !document.querySelector('.dialog-backdrop, .menu, .popover')) ui.clearSelection();
        return;
      }
      if (mod || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const modal = ui.viewer || ui.commandPaletteOpen || ui.settingsOpen || ui.createAlbumOpen || document.querySelector('.dialog-backdrop, .menu');
      if (modal) return;
      if (key === '?' ) { e.preventDefault(); openSettings('shortcuts'); return; }
      if (/^[1-5]$/.test(key) && !e.shiftKey) {
        if (useLibrary.getState().sources.length === 0) return;
        e.preventDefault(); ui.setView(VIEWS[+key - 1]);
      }
    };
    const ctx = (e: MouseEvent) => {
      // custom menus call preventDefault themselves; everything else loses the browser menu, except where text can be edited/copied
      const t = e.target as HTMLElement | null;
      if (window.api?.platform === 'web') return;
      if (t?.closest?.('input, textarea, [contenteditable="true"], .selectable')) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    window.addEventListener('contextmenu', ctx);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('contextmenu', ctx); };
  }, []);
}
