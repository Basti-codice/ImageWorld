import { memo, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '@shared/types';
import { thumbUrl } from '@/lib/media';
import { useLibrary } from '@/state/library';

const WINDOW = 36;

/** Neighbour thumbnails at the bottom. Only a window around the current photo is rendered, so 100k-item lists stay cheap. */
export default memo(function Filmstrip({ ids, index, onSelect }: { ids: string[]; index: number; onSelect(i: number): void }) {
  const byId = useLibrary((s) => s.byId);
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const from = Math.max(0, index - WINDOW), to = Math.min(ids.length, index + WINDOW + 1);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const cur = el.querySelector<HTMLElement>('[aria-current="true"]'); if (!cur) return;
    el.scrollTo({ left: cur.offsetLeft - el.clientWidth / 2 + cur.offsetWidth / 2, behavior: first.current ? 'auto' : 'smooth' });
    first.current = false;
  }, [index, from]);

  const items: React.ReactNode[] = [];
  for (let i = from; i < to; i++) {
    const p: Photo | undefined = byId.get(ids[i]);
    items.push(
      <button key={ids[i]} className={clsx('vw-film__item', i === index && 'is-current')} aria-current={i === index} aria-label={p?.name ?? String(i + 1)} onClick={() => onSelect(i)}>
        {p && <img src={thumbUrl(p, 256)} alt="" loading="lazy" draggable={false} style={{ background: p.color }} />}
        {p?.kind === 'video' && <Play size={10} fill="currentColor" className="vw-film__play" />}
      </button>,
    );
  }
  return <div ref={ref} className="vw-film" role="listbox" aria-label="Filmstrip"><div className="vw-film__track">{items}</div></div>;
});
