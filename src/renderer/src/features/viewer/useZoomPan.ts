import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Photo } from '@shared/types';

/** Slide padding around the fitted image (px). Keep in sync with `.vw-slide` in viewer.css. */
export const PAD = { t: 60, b: 100, x: 28 };
const MIN_Z = 1;

export interface ZoomView { z: number; x: number; y: number; anim: boolean }
const IDLE: ZoomView = { z: 1, x: 0, y: 0, anim: false };

/** Zoom/pan state of the current slide. z is relative to "fit"; x/y are px offsets from the slide centre. */
export function useZoomPan(stage: RefObject<HTMLDivElement | null>, photo: Photo | undefined) {
  const [view, setViewState] = useState<ZoomView>(IDLE);
  const ref = useRef<ZoomView>(IDLE);
  const photoRef = useRef(photo);
  photoRef.current = photo;

  const set = useCallback((v: ZoomView) => { ref.current = v; setViewState(v); }, []);

  /** geometry of the fitted image + stage */
  const geo = useCallback(() => {
    const el = stage.current, p = photoRef.current;
    if (!el || !p) return null;
    const W = el.clientWidth, H = el.clientHeight;
    const aw = Math.max(50, W - PAD.x * 2), ah = Math.max(50, H - PAD.t - PAD.b);
    const ratio = p.width / (p.height || 1);
    const fitW = Math.min(aw, ah * ratio), fitH = fitW / ratio;
    return { W, H, cx: W / 2, cy: PAD.t + ah / 2, fitW, fitH, ratio, p };
  }, [stage]);

  /** zoom factor at which the image is shown 1:1 (one image pixel per CSS pixel) */
  const zoom100 = useCallback(() => { const g = geo(); return g ? Math.max(1, g.p.width / g.fitW) : 1; }, [geo]);
  const maxZ = useCallback(() => Math.max(8, zoom100() * 3), [zoom100]);

  const clamp = useCallback((z: number, x: number, y: number): ZoomView => {
    const g = geo();
    z = Math.min(maxZ(), Math.max(MIN_Z, z));
    if (!g || z <= 1.001) return { z: Math.max(MIN_Z, z), x: 0, y: 0, anim: false };
    const mx = Math.max(0, (g.fitW * z - g.W) / 2), my = Math.max(0, g.fitH * z - g.H);
    const ymax = g.fitH * z / 2 - g.cy, ymin = g.H - g.cy - g.fitH * z / 2;
    return { z, x: Math.min(mx, Math.max(-mx, x)), y: my > 0 ? Math.min(ymax, Math.max(ymin, y)) : 0, anim: false };
  }, [geo, maxZ]);

  /** zoom by factor around a point given relative to the slide centre (px) */
  const zoomAt = useCallback((factor: number, px = 0, py = 0, anim = false) => {
    const cur = ref.current;
    const nz = Math.min(maxZ(), Math.max(MIN_Z, cur.z * factor));
    const r = nz / cur.z;
    set({ ...clamp(nz, px - (px - cur.x) * r, py - (py - cur.y) * r), anim });
  }, [clamp, maxZ, set]);

  const zoomTo = useCallback((z: number, px = 0, py = 0, anim = true) => zoomAt(z / ref.current.z, px, py, anim), [zoomAt]);
  const reset = useCallback((anim = true) => set({ ...IDLE, anim }), [set]);
  const panBy = useCallback((dx: number, dy: number) => { const c = ref.current; set(clamp(c.z, c.x + dx, c.y + dy)); }, [clamp, set]);

  /** fit ↔ 1:1 (or 2.5x for images smaller than the window) */
  const toggle = useCallback((px = 0, py = 0) => {
    if (ref.current.z > 1.02) { reset(true); return; }
    const z100 = zoom100();
    zoomTo(z100 > 1.3 ? z100 : 2.5, px, py, true);
  }, [reset, zoom100, zoomTo]);

  /** pointer position → offset from slide centre */
  const toLocal = useCallback((clientX: number, clientY: number) => {
    const g = geo(), r = stage.current?.getBoundingClientRect();
    if (!g || !r) return { px: 0, py: 0 };
    return { px: clientX - r.left - g.cx, py: clientY - r.top - g.cy };
  }, [geo, stage]);

  /** real zoom percentage (100 = pixel-exact) */
  const percent = useCallback((z: number) => { const g = geo(); return g ? Math.round((g.fitW * z / g.p.width) * 100) : 100; }, [geo]);

  // new photo → back to fit; keep the pan inside bounds when the window resizes
  useEffect(() => { set(IDLE); }, [photo?.id, set]);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => { const c = ref.current; set(clamp(c.z, c.x, c.y)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage, clamp, set]);

  return { view, ref, zoomAt, zoomTo, reset, panBy, toggle, toLocal, percent, zoom100, clamp, set };
}
