import type { Map as MlMap } from 'maplibre-gl';
import type { Polygon } from '@shared/types';
import { circleToPolygon, haversineKm } from '@/lib/geo';

export type DrawToolId = 'rect' | 'lasso' | 'circle';

const NS = 'http://www.w3.org/2000/svg';
const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
const wrapLon = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;

interface Pt { x: number; y: number }

/**
 * Freehand area tools on top of the map (mouse). A tool is single-use: after one shape the tool switches off.
 * Shift+drag always draws a rectangle, whatever tool is active.
 */
export class DrawTool {
  private tool: DrawToolId | null = null;
  private drawing: { kind: DrawToolId; start: Pt; pts: Pt[]; cur: Pt } | null = null;
  private shape: SVGPathElement;
  private ring: SVGCircleElement;
  private readonly container: HTMLElement;

  constructor(
    private map: MlMap,
    private svg: SVGSVGElement,
    private cb: { onDone(poly: Polygon): void; onToolChange(t: DrawToolId | null): void },
  ) {
    this.container = map.getCanvasContainer();
    this.shape = document.createElementNS(NS, 'path');
    this.ring = document.createElementNS(NS, 'circle');
    this.shape.setAttribute('class', 'mp-draw__shape'); this.ring.setAttribute('class', 'mp-draw__shape');
    svg.append(this.shape, this.ring);
    this.container.addEventListener('mousedown', this.onDown, true);
    map.boxZoom.disable();
  }

  get active() { return this.tool; }

  setTool(t: DrawToolId | null) {
    if (this.tool === t) return;
    this.cancel();
    this.tool = t;
    this.container.classList.toggle('mp-tool', !!t);
    this.cb.onToolChange(t);
  }

  cancel() { this.drawing = null; this.render(); window.removeEventListener('mousemove', this.onMove); window.removeEventListener('mouseup', this.onUp); }

  destroy() {
    this.cancel();
    this.container.removeEventListener('mousedown', this.onDown, true);
    this.container.classList.remove('mp-tool');
    this.shape.remove(); this.ring.remove();
  }

  private local(e: MouseEvent): Pt { const r = this.container.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private onDown = (e: MouseEvent) => {
    if (e.button !== 0 || (!this.tool && !e.shiftKey)) return;
    e.stopPropagation(); e.preventDefault();
    const p = this.local(e);
    const kind: DrawToolId = e.shiftKey && !this.tool ? 'rect' : this.tool ?? 'rect';
    this.drawing = { kind: e.shiftKey ? 'rect' : kind, start: p, pts: [p], cur: p };
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    this.render();
  };

  private onMove = (e: MouseEvent) => {
    const d = this.drawing; if (!d) return;
    const p = this.local(e);
    d.cur = p;
    if (d.kind === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 3) d.pts.push(p); }
    this.render();
  };

  private onUp = (e: MouseEvent) => {
    const d = this.drawing; if (!d) return;
    this.onMove(e);
    const poly = this.toPolygon(d);
    this.cancel();
    if (poly) { this.setTool(null); this.cb.onDone(poly); }
  };

  private un(p: Pt): [number, number] | null {
    const ll = this.map.unproject([p.x, p.y]);
    if (!isFinite(ll.lng) || !isFinite(ll.lat)) return null;
    return [wrapLon(ll.lng), clampLat(ll.lat)];
  }

  private toPolygon(d: NonNullable<DrawTool['drawing']>): Polygon | null {
    const out: Polygon = [];
    const push = (p: Pt) => { const q = this.un(p); if (q) out.push(q); };
    if (d.kind === 'rect') {
      const x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
      if (x1 - x0 < 8 || y1 - y0 < 8) return null;
      const N = 12; // sample the edges so the shape follows the screen rectangle on a globe
      for (let i = 0; i < N; i++) push({ x: x0 + ((x1 - x0) * i) / N, y: y0 });
      for (let i = 0; i < N; i++) push({ x: x1, y: y0 + ((y1 - y0) * i) / N });
      for (let i = 0; i < N; i++) push({ x: x1 - ((x1 - x0) * i) / N, y: y1 });
      for (let i = 0; i < N; i++) push({ x: x0, y: y1 - ((y1 - y0) * i) / N });
    } else if (d.kind === 'lasso') {
      if (d.pts.length < 4) return null;
      const step = Math.max(1, Math.ceil(d.pts.length / 240));
      d.pts.forEach((p, i) => { if (i % step === 0) push(p); });
    } else {
      const r = Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y);
      if (r < 6) return null;
      const c = this.un(d.start), e = this.un({ x: d.start.x + r, y: d.start.y });
      if (!c || !e) return null;
      const km = haversineKm(c[1], c[0], e[1], e[0]);
      return circleToPolygon(c[0], c[1], km, 72).map(([lo, la]) => [wrapLon(lo), clampLat(la)] as [number, number]);
    }
    return out.length >= 3 ? out : null;
  }

  private render() {
    const d = this.drawing;
    if (!d) { this.shape.setAttribute('d', ''); this.ring.setAttribute('r', '0'); return; }
    if (d.kind === 'rect') {
      const x0 = Math.min(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      this.shape.setAttribute('d', `M${x0} ${y0}h${w}v${h}h${-w}Z`); this.ring.setAttribute('r', '0');
    } else if (d.kind === 'lasso') {
      this.shape.setAttribute('d', d.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z'); this.ring.setAttribute('r', '0');
    } else {
      this.shape.setAttribute('d', ''); this.ring.setAttribute('cx', String(d.start.x)); this.ring.setAttribute('cy', String(d.start.y));
      this.ring.setAttribute('r', String(Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y)));
    }
  }
}
