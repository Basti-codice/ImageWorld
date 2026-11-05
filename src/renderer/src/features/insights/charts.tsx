import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type CSSProperties } from 'react';
import clsx from 'clsx';
import { scaleLinear } from 'd3-scale';
import { fmtNumber } from '@/lib/format';
import { currentLocale } from '@/i18n';

/* ------------------------------------------------------------------ tooltip */
/** One imperative tooltip for the whole page: mouse-move never re-renders React. */
interface TipApi { show(x: number, y: number, title: string, body?: string): void; hide(): void }
const TipCtx = createContext<TipApi>({ show() {}, hide() {} });

export function TipProvider({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLSpanElement>(null);
  const bodyEl = useRef<HTMLSpanElement>(null);
  const api = useMemo<TipApi>(() => ({
    show(x, y, title, body) {
      const el = box.current; if (!el) return;
      titleEl.current!.textContent = title;
      bodyEl.current!.textContent = body ?? '';
      bodyEl.current!.style.display = body ? '' : 'none';
      el.style.opacity = '1';
      const r = el.getBoundingClientRect();
      const px = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
      const py = y + 18 + r.height > window.innerHeight - 8 ? y - r.height - 12 : y + 18;
      el.style.transform = `translate(${px}px, ${py}px)`;
    },
    hide() { if (box.current) box.current.style.opacity = '0'; },
  }), []);
  return (
    <TipCtx.Provider value={api}>
      {children}
      <div ref={box} className="ins-tip" role="presentation"><span ref={titleEl} className="ins-tip__t" /><span ref={bodyEl} className="ins-tip__b" /></div>
    </TipCtx.Provider>
  );
}

/** Spread onto any element to give it the shared tooltip (mouse + keyboard focus). */
export function useTip() {
  const api = useContext(TipCtx);
  return useCallback((title: string, body?: string) => ({
    onMouseEnter: (e: React.MouseEvent) => api.show(e.clientX, e.clientY, title, body),
    onMouseMove: (e: React.MouseEvent) => api.show(e.clientX, e.clientY, title, body),
    onMouseLeave: () => api.hide(),
    onFocus: (e: React.FocusEvent) => { const r = e.currentTarget.getBoundingClientRect(); api.show(r.left + r.width / 2, r.top, title, body); },
    onBlur: () => api.hide(),
  }), [api]);
}
export const useTipApi = () => useContext(TipCtx);

/* --------------------------------------------------------------------- card */
export function Card({ title, hint, right, className, children, style }: { title?: ReactNode; hint?: ReactNode; right?: ReactNode; className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className={clsx('ins-card', className)} style={style}>
      {(title || right) && (
        <header className="ins-card__head">
          <div className="ins-card__titles">{title && <h3>{title}</h3>}{hint && <p>{hint}</p>}</div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------- column chart */
export interface Col {
  key: string | number;
  label: string;
  /** one value per series; stacked bottom → top */
  values: number[];
  tipTitle: string;
  tipBody?: string;
  /** draw the value above the bar (peak label) */
  peak?: boolean;
}

const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

interface ColumnChartProps {
  cols: Col[];
  /** css colours per series */
  colors: string[];
  height?: number;
  /** show every n-th x label (labels of peak always stay) */
  labelEvery?: number;
  onPick?: (c: Col) => void;
  ariaLabel: string;
  maxWidth?: number;
}

export const ColumnChart = memo(function ColumnChart({ cols, colors, height = 180, labelEvery = 1, onPick, ariaLabel, maxWidth = 40 }: ColumnChartProps) {
  const tip = useTip();
  const { ticks, top } = useMemo(() => {
    const max = Math.max(1, ...cols.map((c) => c.values.reduce((a, b) => a + b, 0)));
    const s = scaleLinear().domain([0, max]).nice(3);
    return { ticks: s.ticks(3).filter((t) => t > 0), top: s.domain()[1] };
  }, [cols]);
  const Tag = onPick ? 'button' : 'div';
  return (
    <div className="cc" style={{ height }} role="group" aria-label={ariaLabel}>
      <div className="cc__axis" aria-hidden>{ticks.map((t) => <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>{compact(t)}</span>)}</div>
      <div className="cc__plot">
        <div className="cc__grid" aria-hidden><i style={{ bottom: 0 }} />{ticks.map((t) => <i key={t} style={{ bottom: `${(t / top) * 100}%` }} />)}</div>
        <div className="cc__cols">
          {cols.map((c, i) => {
            const total = c.values.reduce((a, b) => a + b, 0);
            const empty = total === 0;
            return (
              <Tag key={c.key} className={clsx('cc__col', onPick && !empty && 'is-link')} {...(onPick ? { type: 'button' as const, disabled: empty, onClick: () => onPick(c) } : {})} {...(empty ? {} : tip(c.tipTitle, c.tipBody))} aria-label={`${c.tipTitle}${c.tipBody ? ', ' + c.tipBody : ''}`}>
                <span className="cc__bg" />
                <span className="cc__area">
                  {!empty && (
                    <span className="cc__stack" style={{ height: `${(total / top) * 100}%`, maxWidth }}>
                      {c.peak && <em className="cc__peak">{fmtNumber(total)}</em>}
                      {c.values.map((v, k) => v > 0 && <i key={k} className="cc__seg" style={{ flex: `${v} 1 0`, background: colors[k] }} />)}
                    </span>
                  )}
                </span>
                <span className={clsx('cc__label', (i % labelEvery !== 0 && !c.peak) && 'is-hidden')}>{c.label}</span>
              </Tag>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ---------------------------------------------------------------- row bars */
export interface Row { key: string; label: string; sub?: string; value: number; tipTitle: string; tipBody?: string }

export const RowBars = memo(function RowBars({ rows, onPick, ariaLabel, lead }: { rows: Row[]; onPick?: (r: Row) => void; ariaLabel: string; lead?: (r: Row, i: number) => ReactNode }) {
  const tip = useTip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="rb" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const Tag = onPick ? 'button' : 'div';
        return (
          <li key={r.key}>
            <Tag className={clsx('rb__row', onPick && 'is-link')} {...(onPick ? { type: 'button' as const, onClick: () => onPick(r) } : {})} {...tip(r.tipTitle, r.tipBody)}>
              <span className="rb__top">
                {lead?.(r, i)}
                <span className="rb__label truncate">{r.label}</span>
                {r.sub && <span className="rb__sub truncate">{r.sub}</span>}
                <span className="rb__val tabular">{fmtNumber(r.value)}</span>
              </span>
              <span className="rb__track"><span className="rb__fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} /></span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
});

/* ------------------------------------------------------------ activity heat */
const DAY = 864e5;
export interface HeatProps {
  year: number;
  daily: Map<number, number>;
  onPick: (dayMs: number) => void;
  tipFor: (dayMs: number, n: number) => { title: string; body?: string };
  monthLabels: string[];
  weekdayLabels: string[];
  ariaLabel: string;
}

const CELL = 11, GAP = 3, STEP = CELL + GAP, LEFT = 26, TOP = 16;

export const Heatmap = memo(function Heatmap({ year, daily, onPick, tipFor, monthLabels, weekdayLabels, ariaLabel }: HeatProps) {
  const tipApi = useTipApi();
  const model = useMemo(() => {
    const start = Date.UTC(year, 0, 1);
    const days = (Date.UTC(year + 1, 0, 1) - start) / DAY;
    const offset = (new Date(start).getUTCDay() + 6) % 7; // Monday first
    const dk0 = start / DAY;
    const counts: number[] = [];
    const nz: number[] = [];
    for (let i = 0; i < days; i++) { const n = daily.get(dk0 + i) ?? 0; counts.push(n); if (n) nz.push(n); }
    nz.sort((a, b) => a - b);
    const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 1;
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8);
    const cells = counts.map((n, i) => {
      const lv = n === 0 ? 0 : n <= t1 ? 1 : n <= t2 ? 2 : n <= t3 ? 3 : 4;
      return { n, lv, col: Math.floor((i + offset) / 7), row: (i + offset) % 7, ms: start + i * DAY };
    });
    const cols = Math.ceil((days + offset) / 7);
    const months = Array.from({ length: 12 }, (_, m) => ({ m, col: Math.floor((Date.UTC(year, m, 1) - start) / DAY + offset) / 7 }));
    return { cells, cols, months };
  }, [year, daily]);

  const w = LEFT + model.cols * STEP, h = TOP + 7 * STEP;
  return (
    <svg className="heat" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel} style={{ maxWidth: w * 1.45 }}>
      {model.months.map(({ m, col }) => <text key={m} x={LEFT + Math.floor(col) * STEP} y={9} className="heat__txt">{monthLabels[m]}</text>)}
      {[0, 2, 4].map((r) => <text key={r} x={0} y={TOP + r * STEP + CELL - 1.5} className="heat__txt">{weekdayLabels[r]}</text>)}
      {model.cells.map((c) => (
        <rect
          key={c.ms} className={clsx('heat__cell', `lv${c.lv}`, c.n > 0 && 'is-link')} x={LEFT + c.col * STEP} y={TOP + c.row * STEP} width={CELL} height={CELL} rx={3}
          onMouseMove={(e) => { const t = tipFor(c.ms, c.n); tipApi.show(e.clientX, e.clientY, t.title, t.body); }}
          onMouseLeave={() => tipApi.hide()}
          onClick={c.n > 0 ? () => onPick(c.ms) : undefined}
        />
      ))}
    </svg>
  );
});

/** Tiny hook for rAF-free resize observation. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const widthRef = useRef(0);
  const set = useRef<(w: number) => void>(() => {});
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { widthRef.current = e.contentRect.width; set.current(e.contentRect.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return { ref, widthRef, onWidth: (fn: (w: number) => void) => { set.current = fn; } };
}

export const fmtCompactNumber = (n: number) => new Intl.NumberFormat(currentLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
