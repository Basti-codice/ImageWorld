// STUB – owned by the timeline agent. CONTRACT:
import type { Photo } from '@shared/types';

export interface Trip {
  id: string;
  /** epoch ms of first / last photo */
  from: number;
  to: number;
  photoIds: string[];
  /** centroid */
  lat: number;
  lon: number;
  /** [w,s,e,n] */
  bbox: [number, number, number, number];
  /** dominant place, e.g. "Tokio" / "Japan" */
  title: string;
  countries: string[];
  /** true if mostly far away from the user's home region */
  away: boolean;
}

/** Detects trips/events: clusters of geotagged photos by time gaps + distance (home region inferred from the most-photographed area). */
export function detectTrips(_photos: Photo[]): Trip[] { return []; }
