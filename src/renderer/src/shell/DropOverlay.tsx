import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus } from 'lucide-react';
import { useT, t } from '@/i18n';
import { useUi } from '@/state/ui';
import { addFolderPath } from './sources';

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * Window-wide folder drop target. Also the single place that swallows stray drag&drop so the browser never navigates
 * to a dropped file. Dropped folders become sources (api.shell.pathForFile → api.sources.add).
 */
export default function DropOverlay() {
  const tt = useT();
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setActive(true); };
    // only OS file drags are handled here – in-app drags (albums, tags …) keep their own handlers untouched
    const over = (e: DragEvent) => { if (!hasFiles(e) || !e.dataTransfer) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setActive(false); };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setActive(false);
      const dt = e.dataTransfer; if (!dt || !dt.files.length) return;
      // webkitGetAsEntry must be read synchronously inside the event
      const files = Array.from(dt.files);
      const items = Array.from(dt.items);
      const dirs = files.filter((_, i) => items[i]?.webkitGetAsEntry?.()?.isDirectory);
      if (!dirs.length) { useUi.getState().toast(t('drop.onlyFolders')); return; }
      for (const f of dirs) {
        const path = window.api.shell.pathForFile(f);
        if (path) await addFolderPath(path);
      }
    };
    const end = () => { depth = 0; setActive(false); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop); window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop); window.removeEventListener('dragend', end);
    };
  }, []);

  if (!active) return null;
  return createPortal(
    <div className="dropzone" aria-hidden>
      <div className="dropzone__frame">
        <div className="dropzone__icon"><FolderPlus size={28} strokeWidth={1.5} /></div>
        <div className="dropzone__title">{tt('drop.title')}</div>
        <div className="dropzone__hint">{tt('drop.hint')}</div>
      </div>
    </div>, document.body);
}
