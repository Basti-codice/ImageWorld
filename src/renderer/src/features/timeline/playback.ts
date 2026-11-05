import { create } from 'zustand';

/**
 * "Journey" playback shared by TimelineBar (drives it) and MapView (renders it).
 * cursor === null  -> playback inactive, map shows everything in the current filter.
 * cursor = epoch ms -> map shows photos with sortTime <= cursor, fades older ones, draws the route
 *                      (chronological polyline between photo locations) and flies along it.
 */
interface PlaybackState {
  playing: boolean;
  cursor: number | null;
  /** days of photo-time per real second */
  speed: number;
  /** show the connecting route line while playing */
  route: boolean;
  /** camera follows the newest photo */
  follow: boolean;
  setPlaying(p: boolean): void;
  setCursor(c: number | null): void;
  setSpeed(s: number): void;
  setRoute(r: boolean): void;
  setFollow(f: boolean): void;
  stop(): void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  playing: false, cursor: null, speed: 30, route: true, follow: true,
  setPlaying: (playing) => set({ playing }),
  setCursor: (cursor) => set({ cursor }),
  setSpeed: (speed) => set({ speed }),
  setRoute: (route) => set({ route }),
  setFollow: (follow) => set({ follow }),
  stop: () => set({ playing: false, cursor: null }),
}));
