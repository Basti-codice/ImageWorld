// STUB – owned by the photos agent. CONTRACT (other features rely on this signature):
import type { ReactNode } from 'react';
import type { Photo } from '@shared/types';

export interface PhotoGridProps {
  photos: Photo[];
  /** rendered when photos is empty */
  emptyState?: ReactNode;
  /** rendered at the top inside the scroll container (e.g. album hero) */
  header?: ReactNode;
  /** group rows under day/month headings (default true; false for albums with custom order) */
  grouped?: boolean;
  /** custom open handler; default opens the viewer with the ids of `photos` */
  onOpen?(index: number): void;
}
export function PhotoGrid({ photos }: PhotoGridProps) {
  return <div style={{ padding: 24, color: 'var(--text-3)' }}>PhotoGrid (stub) – {photos.length}</div>;
}
