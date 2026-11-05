import { randomUUID } from 'node:crypto';
import type { Album, AlbumDraft } from '@shared/types';
import type { Store } from './store';

export class AlbumService {
  constructor(private readonly store: Store, private readonly onChanged: (a: Album[]) => void) {}

  private get albums() { return this.store.albums.value; }
  list(): Album[] { return this.albums.slice(); }
  get(id: string): Album | undefined { return this.albums.find((a) => a.id === id); }

  private commit() {
    this.store.albums.touch();
    this.onChanged(this.list());
  }

  create(draft: AlbumDraft): Album {
    const now = Date.now();
    const a: Album = {
      ...(draft as Partial<Album>),
      id: randomUUID(),
      name: String(draft.name ?? '').trim() || 'Album',
      photoIds: Array.isArray(draft.photoIds) ? Array.from(new Set(draft.photoIds)) : [],
      createdAt: now,
      updatedAt: now,
    };
    this.albums.push(a);
    this.commit();
    return a;
  }

  update(id: string, patch: Partial<Omit<Album, 'id' | 'createdAt'>>): Album {
    const i = this.albums.findIndex((a) => a.id === id);
    if (i < 0) throw new Error(`Album not found: ${id}`);
    const next: Album = { ...this.albums[i], ...patch, id, createdAt: this.albums[i].createdAt, updatedAt: Date.now() };
    if (patch.photoIds) next.photoIds = Array.from(new Set(patch.photoIds));
    if (patch.name !== undefined) next.name = String(patch.name).trim() || this.albums[i].name;
    for (const k of Object.keys(next) as Array<keyof Album>) if (next[k] === undefined) delete next[k];
    this.albums[i] = next;
    this.commit();
    return next;
  }

  remove(id: string): void {
    const i = this.albums.findIndex((a) => a.id === id);
    if (i < 0) return;
    this.albums.splice(i, 1);
    this.commit();
  }
}
