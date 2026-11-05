// STUB – owned by the map agent. CONTRACT:
import type { Photo } from '@shared/types';

export interface MiniMapProps {
  photos: Photo[];
  height?: number;
  /** allow pan/zoom (default false = static decorative map that auto-fits the photos) */
  interactive?: boolean;
  /** draw chronological route between photo locations */
  route?: boolean;
  /** highlight a single photo (e.g. in the viewer info panel) */
  activeId?: string;
  className?: string;
}
export function MiniMap({ height = 160 }: MiniMapProps) {
  return <div style={{ height, background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }} />;
}
