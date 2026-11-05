import './ui.css';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useUi } from '@/state/ui';
import { useT } from '@/i18n';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode };
export function Button({ variant = 'default', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return <button {...rest} className={clsx('btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, className)}>{icon}{children}</button>;
}

type IBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; glass?: boolean; active?: boolean };
/** Icon-only button. `label` is used for aria-label + native tooltip. */
export function IconButton({ label, size = 'md', glass, active, className, children, ...rest }: IBtnProps) {
  return <button {...rest} aria-label={label} title={label} className={clsx('ibtn', size !== 'md' && `ibtn--${size}`, glass && 'ibtn--glass', active && 'ibtn--active', className)}>{children}</button>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (v: T) => void }) {
  return <div className="seg" role="group">{options.map((o) => <button key={o.value} title={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Kbd({ children }: { children: ReactNode }) { return <span className="kbd">{children}</span>; }

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true); }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={clsx('dialog', wide && 'dialog--wide')} role="dialog" aria-modal="true">
        <div className="dialog__head">{title}</div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>, document.body);
}

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  const t = useT();
  return createPortal(
    <div className="toasts">{toasts.map((x) => (
      <div key={x.id} className={clsx('toast', x.tone && `toast--${x.tone}`)}>
        <span>{x.message}</span>
        {x.action && <button onClick={() => { x.action!.run(); dismissToast(x.id); }}>{x.action.label}</button>}
        <IconButton label={t('common.close')} size="sm" onClick={() => dismissToast(x.id)}><X size={14} /></IconButton>
      </div>))}
    </div>, document.body);
}

export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void; separatorBefore?: boolean }
/** Context/popover menu anchored at viewport coordinates. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  useEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('mousedown', close, true); addEventListener('keydown', esc); addEventListener('blur', onClose);
    return () => { removeEventListener('mousedown', close, true); removeEventListener('keydown', esc); removeEventListener('blur', onClose); };
  }, [x, y, onClose]);
  return createPortal(
    <div ref={ref} className="menu" style={pos}>
      {items.map((it, i) => (<div key={i}>{it.separatorBefore && <div className="menu__sep" />}<button className={clsx('menu__item', it.danger && 'menu__item--danger')} onClick={() => { it.onSelect(); onClose(); }}>{it.icon}{it.label}</button></div>))}
    </div>, document.body);
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3>{hint && <p style={{ margin: 0, maxWidth: 360 }}>{hint}</p>}{action}</div>;
}
