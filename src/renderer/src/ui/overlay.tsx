import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/* ------------------------------------------------------------------ Tooltip
 * One delegated layer (<TooltipLayer/>, mounted once by the shell). Any element can opt in with
 *   data-tip="Label"  [data-tip-kbd="Ctrl K"]  [data-tip-side="top|bottom|left|right"]
 * IconButton does this automatically. <Tooltip> is a thin wrapper that sets those attributes on its child.
 * Behaviour (as on desktop OSes): ~500 ms delay, instant when moving between neighbours, hides on press/scroll/Esc,
 * shows on keyboard focus (focus-visible) too. */

export type TipSide = 'top' | 'bottom' | 'left' | 'right';

export function Tooltip({ content, kbd, side, children }: { content: ReactNode; kbd?: string; side?: TipSide; children: ReactElement<Record<string, unknown>> }) {
  if (!isValidElement(children)) return children;
  const text = typeof content === 'string' ? content : undefined;
  if (!text) return children;
  return cloneElement(children, { 'data-tip': text, 'data-tip-kbd': kbd, 'data-tip-side': side });
}

interface TipState { text: string; kbd?: string; side: TipSide; rect: DOMRect }

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [dx, setDx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let target: HTMLElement | null = null;
    let lastHide = 0;
    let watch = 0;
    const clear = () => { clearTimeout(timer); clearInterval(watch); };
    const hide = () => { clear(); target = null; setTip((cur) => { if (cur) lastHide = Date.now(); return null; }); };
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tip');
      if (!text || !el.isConnected) return;
      setDx(0);
      setTip({ text, kbd: el.getAttribute('data-tip-kbd') || undefined, side: (el.getAttribute('data-tip-side') as TipSide) || 'bottom', rect: el.getBoundingClientRect() });
      clearInterval(watch);
      watch = window.setInterval(() => { if (!el.isConnected || !el.matches(':hover, :focus-visible')) hide(); }, 400);
    };
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e.target);
      if (el === target) return;
      clear(); target = el;
      if (!el) { hide(); return; }
      const quick = Date.now() - lastHide < 350 || document.querySelector('.tooltip');
      timer = window.setTimeout(() => show(el), quick ? 40 : 520);
    };
    const onFocus = (e: FocusEvent) => {
      const el = find(e.target);
      if (!el || !el.matches(':focus-visible')) return;
      clear(); target = el; timer = window.setTimeout(() => show(el), 120);
    };
    const onBlur = () => hide();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Tab') hide(); };
    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('focusout', onBlur, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('pointerleave', hide);
    return () => {
      clear();
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', onBlur, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('pointerleave', hide);
    };
  }, []);

  // keep the bubble inside the viewport (only horizontal shift for top/bottom tips)
  useLayoutEffect(() => {
    if (!tip || !ref.current || tip.side === 'left' || tip.side === 'right') return;
    const r = ref.current.getBoundingClientRect();
    const over = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
    if (over) setDx(over);
  }, [tip]);

  if (!tip) return null;
  const { rect, side } = tip;
  const style: CSSProperties = { ['--dx' as string]: `${dx}px` };
  if (side === 'bottom') { style.left = rect.left + rect.width / 2; style.top = rect.bottom + 8; }
  else if (side === 'top') { style.left = rect.left + rect.width / 2; style.top = rect.top - 8; }
  else if (side === 'right') { style.left = rect.right + 10; style.top = rect.top + rect.height / 2; }
  else { style.left = rect.left - 10; style.top = rect.top + rect.height / 2; }
  return createPortal(
    <div ref={ref} role="tooltip" className={clsx('tooltip', `tooltip--${side}`)} style={style}>
      <span>{tip.text}</span>{tip.kbd && <kbd>{tip.kbd}</kbd>}
    </div>, document.body);
}

/* ------------------------------------------------------------------ Popover
 * Non-modal panel anchored to an element. Closes on outside press, Esc, window blur/resize.
 * Focus moves into the panel on open and is restored to the anchor on close. */

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** element (or ref to it) the panel is attached to – clicks on it do not count as "outside" */
  anchor: HTMLElement | null | RefObject<HTMLElement | null>;
  side?: 'top' | 'bottom' | 'right' | 'left';
  /** alignment along the anchor edge */
  align?: 'start' | 'center' | 'end';
  offset?: number;
  width?: number | string;
  className?: string;
  /** accessible name */
  label?: string;
  children: ReactNode;
}

const resolveAnchor = (a: PopoverProps['anchor']) => (a && 'current' in a ? a.current : a);

export function Popover({ open, onClose, anchor, side = 'bottom', align = 'end', offset = 8, width, className, label, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' });
  const [placed, setPlaced] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current, a = resolveAnchor(anchor);
    if (!el || !a) return;
    const place = () => {
      const ar = a.getBoundingClientRect(), pr = el.getBoundingClientRect();
      let left: number, top: number;
      if (side === 'bottom' || side === 'top') {
        left = align === 'start' ? ar.left : align === 'end' ? ar.right - pr.width : ar.left + (ar.width - pr.width) / 2;
        top = side === 'bottom' ? ar.bottom + offset : ar.top - pr.height - offset;
        if (side === 'bottom' && top + pr.height > innerHeight - 8 && ar.top - pr.height - offset > 8) top = ar.top - pr.height - offset;
      } else {
        top = align === 'start' ? ar.top : align === 'end' ? ar.bottom - pr.height : ar.top + (ar.height - pr.height) / 2;
        left = side === 'right' ? ar.right + offset : ar.left - pr.width - offset;
      }
      left = Math.max(8, Math.min(left, innerWidth - pr.width - 8));
      top = Math.max(8, Math.min(top, innerHeight - pr.height - 8));
      setPos({ left, top }); setPlaced(true);
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(el);
    addEventListener('resize', place);
    return () => { ro.disconnect(); removeEventListener('resize', place); };
  }, [open, anchor, side, align, offset]);

  useEffect(() => {
    if (!open) return;
    const a = resolveAnchor(anchor);
    const prev = document.activeElement as HTMLElement | null;
    const down = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || a?.contains(t)) return;
      // clicks inside another overlay (dialog, menu) opened from the panel must not close it
      if ((t as Element).closest?.('.menu, .dialog-backdrop')) return;
      closeRef.current();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    const blur = () => closeRef.current();
    addEventListener('mousedown', down, true); addEventListener('keydown', key, true); addEventListener('blur', blur);
    return () => {
      removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); removeEventListener('blur', blur);
      const inside = ref.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (inside) (a && a.isConnected ? a : prev)?.focus?.({ preventScroll: true });
    };
  }, [open, anchor]);

  useEffect(() => { if (!open) setPlaced(false); else if (placed) ref.current?.focus({ preventScroll: true }); }, [open, placed]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-label={label} className={clsx('popover', `popover--${side}`, className)} style={{ ...pos, width }}>
      {children}
    </div>, document.body);
}
