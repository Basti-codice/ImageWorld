import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderMinus, FolderPlus, Heart, MapPin, Tag, X, FolderHeart } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '@shared/types';
import { Button, IconButton } from '@/ui';
import { tn, useT } from '@/i18n';
import { useUi } from '@/state/ui';
import { useLibrary } from '@/state/library';
import AlbumPicker from './AlbumPicker';
import TagEditor from '@/features/viewer/TagEditor';
import { isLiveAlbum, removeFromAlbum } from './actions';
import './selectionbar.css';

type Pop = 'album' | 'tags' | null;

export default function SelectionBar() {
  const size = useUi((s) => s.selection.size);
  const [mounted, setMounted] = useState(size > 0);
  const last = useRef(size);
  if (size > 0) last.current = size;
  useEffect(() => {
    if (size > 0) { setMounted(true); return; }
    const h = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(h);
  }, [size]);
  if (!mounted) return null;
  return <Bar leaving={size === 0} count={last.current} />;
}

function Bar({ leaving, count }: { leaving: boolean; count: number }) {
  const t = useT();
  const selection = useUi((s) => s.selection);
  const albumId = useUi((s) => s.albumId);
  const view = useUi((s) => s.view);
  const byId = useLibrary((s) => s.byId);
  const albums = useLibrary((s) => s.albums);
  const [pop, setPop] = useState<Pop>(null);
  const ref = useRef<HTMLDivElement>(null);

  // snapshot while leaving, so the bar doesn't flash empty content
  const ids = useMemo(() => [...selection], [selection]);
  const photos = useMemo(() => ids.map((id) => byId.get(id)).filter(Boolean) as Photo[], [ids, byId]);
  const allFav = photos.length > 0 && photos.every((p) => p.favorite);
  const tagUnion = useMemo(() => [...new Set(photos.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)), [photos]);
  const album = view === 'albums' && albumId ? albums.find((a) => a.id === albumId) : undefined;
  const canRemove = !!album && !isLiveAlbum(album) && ids.some((id) => album.photoIds.includes(id));

  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPop(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPop(null); } };
    addEventListener('mousedown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); };
  }, [pop]);

  const ui = useUi.getState;
  const toggle = (p: Exclude<Pop, null>) => setPop((cur) => (cur === p ? null : p));

  const lib = useLibrary.getState;
  const addTag = (tag: string) => {
    // group photos by resulting tag set → one IPC call per distinct set
    const groups = new Map<string, { ids: string[]; tags: string[] }>();
    for (const p of photos) {
      if (p.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) continue;
      const tags = [...p.tags, tag]; const key = tags.join('\u0000');
      const g = groups.get(key) ?? { ids: [], tags }; g.ids.push(p.id); groups.set(key, g);
    }
    for (const g of groups.values()) void lib().updatePhotos(g.ids, { tags: g.tags });
  };
  const removeTag = (tag: string) => {
    const groups = new Map<string, { ids: string[]; tags: string[] }>();
    for (const p of photos) {
      if (!p.tags.includes(tag)) continue;
      const tags = p.tags.filter((x) => x !== tag); const key = tags.join('\u0000');
      const g = groups.get(key) ?? { ids: [], tags }; g.ids.push(p.id); groups.set(key, g);
    }
    for (const g of groups.values()) void lib().updatePhotos(g.ids, { tags: g.tags });
  };

  return (
    <div ref={ref} className={clsx('selbar glass', leaving && 'is-leaving')} role="toolbar" aria-label={tn('sel.count', count)}>
      <div className="selbar__count">
        <IconButton size="sm" label={t('sel.clear')} onClick={() => ui().clearSelection()}><X size={15} /></IconButton>
        <span className="tabular">{tn('sel.count', count)}</span>
      </div>
      <i className="selbar__sep" />
      <Button title={t('sel.createAlbum')} variant="primary" size="sm" icon={<FolderHeart size={15} />} onClick={() => ui().setCreateAlbumOpen(true)}><span className="selbar__lbl">{t('sel.createAlbum')}</span></Button>

      <div className="selbar__anchor">
        <Button title={t('sel.addToAlbum')} variant="ghost" size="sm" aria-expanded={pop === 'album'} icon={<FolderPlus size={15} />} onClick={() => toggle('album')}><span className="selbar__lbl">{t('sel.addToAlbum')}</span></Button>
        {pop === 'album' && <AlbumPicker className="selbar__pop" ids={ids} onDone={() => setPop(null)} onNew={() => ui().setCreateAlbumOpen(true)} />}
      </div>

      <Button variant="ghost" size="sm" aria-pressed={allFav} className={clsx(allFav && 'is-fav')} icon={<Heart size={15} fill={allFav ? 'currentColor' : 'none'} />}
        onClick={() => void lib().updatePhotos(ids, { favorite: !allFav })}><span className="selbar__lbl">{t('sel.favorite')}</span></Button>
      <Button title={t('albums.sel.place')} variant="ghost" size="sm" icon={<MapPin size={15} />} onClick={() => ui().setPlacing(ids)}><span className="selbar__lbl">{t('albums.sel.place')}</span></Button>

      <div className="selbar__anchor">
        <Button title={t('albums.sel.tags')} variant="ghost" size="sm" aria-expanded={pop === 'tags'} icon={<Tag size={15} />} onClick={() => toggle('tags')}><span className="selbar__lbl">{t('albums.sel.tags')}</span></Button>
        {pop === 'tags' && (
          <div className="selbar__pop selbar__tags">
            <div className="selbar__poptitle">{t('albums.sel.tags.title', { n: count })}</div>
            <TagEditor tags={tagUnion} onAdd={addTag} onRemove={removeTag} autoFocus />
          </div>
        )}
      </div>

      {canRemove && album && (
        <>
          <i className="selbar__sep" />
          <Button title={t('albums.sel.removeFromAlbum')} variant="ghost" size="sm" icon={<FolderMinus size={15} />} onClick={() => { void removeFromAlbum(album, ids.filter((id) => album.photoIds.includes(id))); ui().clearSelection(); }}><span className="selbar__lbl">{t('albums.sel.removeFromAlbum')}</span></Button>
        </>
      )}
    </div>
  );
}
