import './ui.css';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type Ref, type ReactNode, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, X, Check } from 'lucide-react';
import { useUi } from '@/state/ui';
import { useT } from '@/i18n';
import { Spinner } from './controls';
import type { TipSide } from './overlay';

export * from './overlay';
export * from './controls';

/* ------------------------------------------------------------------ Buttons */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean; ref?: Ref<HTMLButtonElement> };
export function Button({ variant = 'default', size = 'md', icon, loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={clsx('btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, className)}>
      {loading ? <Spinner size={14} /> : icon}{children}
    </button>
  );
}

type IBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; glass?: boolean; active?: boolean; shortcut?: string; tipSide?: TipSide; ref?: Ref<HTMLButtonElement> };
/** Icon-only button. `label` becomes aria-label and the (delayed, themed) tooltip; optional `shortcut` is shown inside the tooltip. */
export function IconButton({ label, size = 'md', glass, active, shortcut, tipSide, className, children, ...rest }: IBtnProps) {
  return (
    <button type="button" {...rest} aria-label={label} data-tip={label} data-tip-kbd={shortcut} data-tip-side={tipSide}
      className={clsx('ibtn', size !== 'md' && `ibtn--${size}`, glass && 'ibtn--glass', active && 'ibtn--active', className)}>{children}</button>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({ value, options, onChange, label, size }: { value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (v: T) => void; label?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={clsx('seg', size === 'sm' && 'seg--sm')} role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" data-tip={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <span className="kbd">{children}</span>; }

/* ------------------------------------------------------------------ Dialog (modal, focus trap, focus restore, Esc closes the top-most only) */
const dialogStack: symbol[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
  /** @deprecated use size="lg" */
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** body without padding / scrolling – for dialogs that lay out their own panes (Settings) */
  flush?: boolean;
  className?: string;
  /** fixed height (e.g. 640 or '72vh') */
  height?: number | string;
  /** hide the title row (the child renders its own heading, use `ariaLabel`) */
  ariaLabel?: string;
}
export function Dialog({ title, onClose, children, footer, wide, size, flush, className, height, ariaLabel }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const token = Symbol('dialog'); dialogStack.push(token);
    const el = ref.current!;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el).focus({ preventScroll: true });
    const h = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      const target = e.target as Element | null;
      if (e.key === 'Escape') {
        if (target?.closest?.('.menu, .popover, .tooltip')) return;
        e.stopPropagation(); closeRef.current();
      } else if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1], active = document.activeElement;
        if (!el.contains(active)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', h as EventListener, true);
    return () => {
      window.removeEventListener('keydown', h as EventListener, true);
      const i = dialogStack.indexOf(token); if (i >= 0) dialogStack.splice(i, 1);
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);
  const sz = size ?? (wide ? 'lg' : 'md');
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} className={clsx('dialog', `dialog--${sz}`, flush && 'dialog--flush', className)} style={height ? { height } : undefined} role="dialog" aria-modal="true" aria-labelledby={ariaLabel ? undefined : titleId} aria-label={ariaLabel}>
        {!ariaLabel && <div className="dialog__head" id={titleId}>{title}</div>}
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>, document.body);
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onClose }: { title: ReactNode; message?: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={title} size="sm" onClose={onClose} footer={<>
      <Button data-autofocus variant="ghost" onClick={onClose}>{cancelLabel ?? t('common.cancel')}</Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
    </>}>
      {message && <div className="dialog__message">{message}</div>}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Toasts */
const TONE_ICON = { success: CheckCircle2, danger: AlertCircle, info: Info } as const;
export function Toasts() {
  const { toasts, dismissToast } = useUi();
  const t = useT();
  const visible = toasts.slice(-4);
  return createPortal(
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">{visible.map((x) => {
      const Icon = TONE_ICON[x.tone ?? 'info'];
      return (
        <div key={x.id} role="status" className={clsx('toast', `toast--${x.tone ?? 'info'}`)}>
          <Icon size={16} className="toast__icon" aria-hidden />
          <span className="toast__msg">{x.message}</span>
          {x.action && <button type="button" className="toast__action" onClick={() => { x.action!.run(); dismissToast(x.id); }}>{x.action.label}</button>}
          <IconButton label={t('common.close')} size="sm" onClick={() => dismissToast(x.id)}><X size={14} /></IconButton>
        </div>
      );
    })}
    </div>, document.body);
}

/* ------------------------------------------------------------------ Menu (keyboard: ↑ ↓ Home End, type-ahead, Enter/Space, Esc, Tab closes) */
export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void; separatorBefore?: boolean; disabled?: boolean; checked?: boolean; shortcut?: string }
/** Context/popover menu anchored at viewport coordinates. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const typed = useRef({ s: '', t: 0 });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    el.focus({ preventScroll: true });
    const close = (e: Event) => { if (!el.contains(e.target as Node)) closeRef.current(); };
    const blur = () => closeRef.current();
    addEventListener('mousedown', close, true); addEventListener('blur', blur); addEventListener('resize', blur);
    return () => {
      removeEventListener('mousedown', close, true); removeEventListener('blur', blur); removeEventListener('resize', blur);
      const a = document.activeElement;
      if (prev && prev.isConnected && (el.contains(a) || a === document.body)) prev.focus({ preventScroll: true });
    };
  }, []);

  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
  const onKeyDown = (e: KeyboardEvent) => {
    const list = buttons(); const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeRef.current(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.key !== ' ') {
      const now = Date.now(); const ty = typed.current;
      ty.s = now - ty.t > 700 ? e.key.toLowerCase() : ty.s + e.key.toLowerCase(); ty.t = now;
      const hit = list.find((b) => b.textContent?.trim().toLowerCase().startsWith(ty.s));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  };

  return createPortal(
    <div ref={ref} className="menu" role="menu" tabIndex={-1} style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore && <div className="menu__sep" role="separator" />}
          <button
            type="button" role={it.checked != null ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} disabled={it.disabled} tabIndex={-1}
            className={clsx('menu__item', it.danger && 'menu__item--danger')}
            onMouseMove={(e) => { if (document.activeElement !== e.currentTarget && !it.disabled) e.currentTarget.focus({ preventScroll: true }); }}
            onClick={() => { it.onSelect(); closeRef.current(); }}
          >
            <span className="menu__icon">{it.checked ? <Check size={15} /> : it.icon}</span>
            <span className="menu__label">{it.label}</span>
            {it.shortcut && <span className="menu__kbd">{it.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>, document.body);
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}
