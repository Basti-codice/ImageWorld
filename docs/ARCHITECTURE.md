# ImageWorld – Architecture & Team Rules

Windows desktop app (Electron + React + TypeScript). It gives you a beautiful overview of your photos:
a world map (heatmap, thumbnail clusters, globe), a timeline with "journey" playback, powerful search/filters,
area selection → albums. Folders (incl. OneDrive) are **indexed in place and kept in sync**; originals are never copied into the app or modified.

## Stack
- Electron 45 (main + preload + renderer), electron-vite 6, Vite 8, React 19, TypeScript 7 (native tsc – `baseUrl` is gone, use `paths` with `./`), zustand 5, MapLibre GL 6, lucide-react, @tanstack/react-virtual, d3-scale/array/time.
- Main: exiftool-vendored (metadata, RAW previews, video GPS), sharp (thumbnails), libheif-js (HEIC), ffmpeg-static (video frames), chokidar (watch), all-the-cities + kdbush/geokdbush (offline reverse geocoding), world-atlas + topojson-client (bundled offline basemap).
- Data lives in `app.getPath('userData')`: `settings.json`, `sources.json`, `albums.json`, `userstate.json` (favorites/ratings/tags/manual locations keyed by photo id), `index/<sourceId>.json` (metadata cache), `thumbs/` (disk cache).

## Process model / contract
`src/shared/types.ts` is THE contract (Photo, Source, Album, Settings, `ImageWorldApi`). Renderer only talks to `window.api`.
Images are shown via `lib/media.ts` → custom protocols `iw-thumb://<id>/<256|512|1600>` and `iw-file://<id>`.
In plain-browser mode (`npm run dev:web`, port 5199, already running with HMR) `src/renderer/src/api/mock.ts` provides ~5k demo photos incl. procedural thumbnails – use it for all UI work and screenshots.

```
src/shared/types.ts           contract
src/main/**                   main process (backend agent)
src/preload/index.ts          bridge (done; keep in sync with ImageWorldApi)
src/renderer/src/state/       library.ts (photos, sources, albums, settings), ui.ts (view, filters, selection, viewer…), derived.ts (filtered/geo lists)
src/renderer/src/lib/         geo, filter, format, media helpers
src/renderer/src/ui/          design-system primitives (Button, IconButton, Dialog, Menu, Toasts, Segmented, Switch, Kbd, EmptyState, Logo)
src/renderer/src/shell/       App, Titlebar, Sidebar
src/renderer/src/features/*   one folder per feature, each with its own i18n.ts (keys prefixed `<feature>.`)
```

## Product principles (read this, it decides whether the app feels "big-company")
- Looks like a mature product from a large company (think Apple Photos × Lightroom × Google Earth), NOT like generated UI: restrained neutral surfaces, ONE accent colour, tight typography (Inter), 4px grid, 1px hairline borders, subtle elevation, real content (photos/map) is the hero.
- Forbidden "AI look": purple/pink gradient washes, glow/neon, gradient text, emoji as icons, giant rounded cards everywhere, centered hero blurbs, generic stock illustrations, lorem ipsum, over-explaining copy.
- Use only tokens from `styles/tokens.css` and primitives from `ui/`. Icons: lucide-react, 16–18px, 1.75 stroke. Both dark (default) and light theme must work.
- Every list/grid must handle: empty state, loading skeleton, 50 000+ items (virtualise!), keyboard navigation, focus rings, reduced-motion.
- Motion: 120–360 ms, `--ease`; animate transform/opacity only; never block interaction.
- Copy is bilingual: add EVERY user-visible string to your feature's `i18n.ts` (de + en) and use `useT()` / `t()` / `tn()`. German is the primary voice: concise, friendly, "du"-form is NOT used – use neutral imperative/noun phrasing ("Album erstellen").
- Non-destructive: never write to the user's image files. Favorites/ratings/tags/manual locations/albums live in the app data.
- Performance budget: first paint of map < 1 s with 100k photos; scrolling grid 60 fps; filter changes < 100 ms for 100k photos.

## Collaboration rules (several agents work in this tree at the same time)
1. Only edit files in YOUR ownership area (listed in your task). Additive, minimal edits to shared files (`state/*`, `lib/*`, `shared/types.ts`, `api/mock.ts`, `ui/*`) are allowed when unavoidable: re-read the file right before editing, use targeted Edit (never rewrite/reformat whole shared files), keep changes backwards compatible. Never rename/remove existing exports.
2. Do NOT run any git command (no add/commit/stash/checkout) – the lead commits. Do NOT run `npm install` for new packages unless it's essential; if you must, say which package and why in your final report (pre-installed list is in package.json).
3. Other agents' code may be temporarily broken/stubbed. Ignore type errors in files you don't own; make sure YOUR files typecheck: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep <yourdir>` (renderer) / `-p tsconfig.node.json` (main).
4. The renderer dev server (`npm run dev:web`, http://127.0.0.1:5199/) is ALREADY running with HMR. Do not start another one on that port. Take screenshots with `node tests/shot.mjs "<query>" <out.png> [w] [h] [--js "<code>"]` into your scratchpad dir and LOOK at them (Read the png) – iterate until it looks excellent. Query flags of the mock: `?empty=1` (no folders → onboarding), `?albums=1` (one sample album).
5. External map tiles / geocoders are NOT reachable in this sandbox (they are in production). Everything must degrade gracefully offline and be verifiable here.
6. Finish with a SHORT report: what you built, files, how verified, known gaps/risks, shared files you touched. No long prose.
