/** Fixed accent palette for albums (stored as "#rrggbb" on Album.color). */
export const ALBUM_COLORS = ['#4b94ff', '#19c3d6', '#3ccf8e', '#f2b441', '#ff6a3d', '#ff5d7a', '#9b8cff', '#8b95a8'] as const;
export const DEFAULT_ALBUM_COLOR: string = ALBUM_COLORS[0];
export const albumColor = (c?: string) => c || DEFAULT_ALBUM_COLOR;
