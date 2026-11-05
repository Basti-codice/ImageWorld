/**
 * ImageWorld – shared contract between main process, preload and renderer.
 * Everything that crosses the IPC boundary is defined here. Keep it JSON-serialisable.
 */

export type MediaKind = 'photo' | 'video';

export interface Place {
  city: string;
  region?: string;
  country: string;
  /** ISO 3166-1 alpha-2, upper-case, e.g. "DE" */
  countryCode: string;
}

/** A single indexed media file. User-state (favorite, rating, tags, manual location) is already merged in. */
export interface Photo {
  /** stable id = hash of absolute path */
  id: string;
  /** absolute path on disk (original file is never modified) */
  path: string;
  sourceId: string;
  name: string;
  kind: MediaKind;
  /** lower-case extension without dot, e.g. "jpg" */
  ext: string;
  size: number;
  /** file mtime, epoch ms */
  mtime: number;
  /** capture time as epoch ms (EXIF local time interpreted as UTC to avoid TZ shifting), null if unknown (falls back to mtime in `sortTime`) */
  takenAt: number | null;
  /** takenAt ?? mtime – always set, use for sorting/timeline */
  sortTime: number;
  /** display dimensions AFTER applying EXIF orientation */
  width: number;
  height: number;
  /** seconds, videos only */
  duration?: number;
  lat: number | null;
  lon: number | null;
  alt?: number | null;
  /** where the coordinates come from: embedded EXIF/video metadata or assigned manually by the user */
  geoSource: 'exif' | 'manual' | null;
  place?: Place;
  camera?: string;
  lens?: string;
  iso?: number;
  /** f-number, e.g. 1.8 */
  aperture?: number;
  /** e.g. "1/250" */
  shutter?: string;
  /** mm */
  focalLength?: number;
  /** average colour "#rrggbb" – used as placeholder while the thumbnail loads */
  color?: string;
  favorite: boolean;
  /** 0..5 */
  rating: number;
  tags: string[];
}

/** Compact patch of user-owned state. `location: null` removes a manual location. */
export interface PhotoPatch {
  favorite?: boolean;
  rating?: number;
  tags?: string[];
  location?: { lat: number; lon: number } | null;
}

export type SourceKind = 'local' | 'onedrive' | 'network';
export type SourceStatus = 'idle' | 'scanning' | 'offline' | 'error';

/** A watched folder. Files stay where they are – ImageWorld only indexes them. */
export interface Source {
  id: string;
  path: string;
  label: string;
  kind: SourceKind;
  status: SourceStatus;
  photoCount: number;
  /** epoch ms of last finished scan */
  lastScan: number | null;
  error?: string;
}

export interface ScanProgress {
  sourceId: string;
  phase: 'discovering' | 'reading' | 'thumbnails' | 'done';
  done: number;
  total: number;
  currentFile?: string;
}

export interface LibraryDiff {
  added: Photo[];
  updated: Photo[];
  removedIds: string[];
}

/** Closed polygon in [lon, lat]. First point need not be repeated at the end. */
export type Polygon = Array<[number, number]>;

export interface AreaSelection {
  /** polygon (rectangles/lasso/circles are all converted to polygons) */
  polygon: Polygon;
  /** optional time window (epoch ms) combined with the polygon */
  from?: number;
  to?: number;
}

export interface Album {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** ordered snapshot of photo ids that belong to the album */
  photoIds: string[];
  coverPhotoId?: string;
  /** if the album was created from a map selection we remember the area */
  area?: AreaSelection;
  /** live area album: membership is re-evaluated against `area` whenever the library changes (photoIds are then ignored) */
  live?: boolean;
  /** accent colour from a fixed palette, "#rrggbb" */
  color?: string;
}

export type AlbumDraft = Pick<Album, 'name'> & Partial<Omit<Album, 'id' | 'createdAt' | 'updatedAt'>>;

export type ThemeMode = 'system' | 'dark' | 'light';
export type Language = 'system' | 'de' | 'en';
export type MapStyleId = 'dark' | 'light' | 'satellite' | 'voyager';
export type MapProjection = 'mercator' | 'globe';

export interface Settings {
  language: Language;
  theme: ThemeMode;
  mapStyle: MapStyleId;
  mapProjection: MapProjection;
  /** show heatmap layer on map */
  heatmap: boolean;
  /** show thumbnail clusters on map */
  thumbMarkers: boolean;
  /** use online reverse-geocoding/forward search (Nominatim). Photos never leave the machine. */
  onlineSearch: boolean;
  /** skip OneDrive "online-only" placeholder files instead of downloading them to read metadata */
  skipCloudOnlyFiles: boolean;
  /** max thumbnail cache size in MB */
  thumbCacheMB: number;
  /** show sidebar labels */
  sidebarCollapsed: boolean;
  /** show the timeline bar */
  timelineVisible: boolean;
  /** first-run onboarding finished */
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  theme: 'dark',
  mapStyle: 'dark',
  mapProjection: 'globe',
  heatmap: false,
  thumbMarkers: true,
  onlineSearch: true,
  skipCloudOnlyFiles: false,
  thumbCacheMB: 2048,
  sidebarCollapsed: false,
  timelineVisible: true,
  onboardingDone: false,
};

export interface GeocodeResult {
  name: string;
  /** secondary line, e.g. "Bayern, Deutschland" */
  detail?: string;
  lat: number;
  lon: number;
  /** [west, south, east, north] */
  bbox?: [number, number, number, number];
  kind?: 'country' | 'city' | 'place' | 'address';
}

export interface ExportResult {
  copied: number;
  failed: number;
  folder: string | null;
}

export type ThumbSize = 256 | 512 | 1600;

/**
 * API exposed on `window.api` by the preload script (and by a mock in plain-browser dev mode).
 * All methods are async. Events return an unsubscribe function.
 */
export interface ImageWorldApi {
  platform: 'win32' | 'darwin' | 'linux' | 'web';
  library: {
    /** full snapshot of the current index */
    getAll(): Promise<Photo[]>;
    onChanged(cb: (diff: LibraryDiff) => void): () => void;
    update(ids: string[], patch: PhotoPatch): Promise<void>;
  };
  sources: {
    list(): Promise<Source[]>;
    /** opens the native folder picker; resolves with the added sources (empty if cancelled) */
    pickAndAdd(): Promise<Source[]>;
    add(path: string): Promise<Source>;
    remove(id: string): Promise<void>;
    rescan(id?: string): Promise<void>;
    onChanged(cb: (sources: Source[]) => void): () => void;
    onProgress(cb: (p: ScanProgress) => void): () => void;
    /** detects e.g. OneDrive folders so the UI can offer them as one-click quick-adds */
    suggestions(): Promise<Array<{ label: string; path: string; kind: SourceKind }>>;
  };
  albums: {
    list(): Promise<Album[]>;
    create(draft: AlbumDraft): Promise<Album>;
    update(id: string, patch: Partial<Omit<Album, 'id' | 'createdAt'>>): Promise<Album>;
    remove(id: string): Promise<void>;
    onChanged(cb: (albums: Album[]) => void): () => void;
    /** copies the album's original files to a user-picked folder */
    exportToFolder(id: string): Promise<ExportResult>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    onChanged(cb: (s: Settings) => void): () => void;
  };
  geocode: {
    search(query: string): Promise<GeocodeResult[]>;
  };
  shell: {
    showInFolder(photoId: string): Promise<void>;
    openOriginal(photoId: string): Promise<void>;
    /** clears thumbnail cache; re-generated lazily */
    clearThumbCache(): Promise<void>;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    api: ImageWorldApi;
  }
}

/** Custom protocols served by the main process (also registered as no-op in web mode via the mock) */
export const THUMB_PROTOCOL = 'iw-thumb'; // iw-thumb://<photoId>/<size>
export const FILE_PROTOCOL = 'iw-file'; // iw-file://<photoId>  (original file, range requests supported for video)
