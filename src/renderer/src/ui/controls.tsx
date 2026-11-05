import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ Slider
 * Native <input type=range> (free keyboard + screen-reader support) with a themed track. */
export interface SliderProps {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
  /** fired on pointer release / key up – use for expensive work */
  onCommit?: (v: number) => void;
  label: string;
  /** text shown in the aria-valuetext */
  format?: (v: number) => string;
  className?: string;
  disabled?: boolean;
  width?: number | string;
}
export function Slider({ value, min, max, step = 1, onChange, onCommit, label, format, className, disabled, width }: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range" className={clsx('slider', className)} min={min} max={max} step={step} value={value} disabled={disabled}
      aria-label={label} aria-valuetext={format?.(value)}
      style={{ ['--p' as string]: `${pct}%`, width } as CSSProperties}
      onChange={(e) => onChange(+e.target.value)}
      onPointerUp={(e) => onCommit?.(+(e.target as HTMLInputElement).value)}
      onKeyUp={(e) => onCommit?.(+(e.target as HTMLInputElement).value)}
    />
  );
}

/* ------------------------------------------------------------------ Tabs */
export interface TabItem<T extends string> { value: T; label: ReactNode; icon?: ReactNode; count?: number | string; disabled?: boolean }
export interface TabsProps<T extends string> {
  value: T; onChange: (v: T) => void; items: Array<TabItem<T>>;
  /** 'underline' (default, horizontal), 'pill' (horizontal, filled), 'side' (vertical list as in settings) */
  variant?: 'underline' | 'pill' | 'side';
  label?: string;
  idPrefix?: string;
  className?: string;
}
export const tabId = (prefix: string, v: string) => `${prefix}-tab-${v}`;
export const panelId = (prefix: string, v: string) => `${prefix}-panel-${v}`;
/** Spread on the content element of the active tab. */
export const tabPanelProps = (prefix: string, v: string) => ({ role: 'tabpanel' as const, id: panelId(prefix, v), 'aria-labelledby': tabId(prefix, v), tabIndex: 0 });

export function Tabs<T extends string>({ value, onChange, items, variant = 'underline', label, idPrefix, className }: TabsProps<T>) {
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const vertical = variant === 'side';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  const onKey = (e: KeyboardEvent) => {
    const cur = items.findIndex((it) => it.value === value);
    const at = enabled.indexOf(cur);
    let next = -1;
    if (e.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = enabled[(at + 1) % enabled.length];
    else if (e.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next < 0) return;
    e.preventDefault(); onChange(items[next].value); refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation={vertical ? 'vertical' : 'horizontal'} className={clsx('tabs', `tabs--${variant}`, className)} onKeyDown={onKey}>
      {items.map((it, i) => (
        <button
          key={it.value} ref={(el) => { refs.current[i] = el; }} role="tab" id={tabId(prefix, it.value)} aria-controls={panelId(prefix, it.value)}
          aria-selected={it.value === value} tabIndex={it.value === value ? 0 : -1} disabled={it.disabled}
          className="tabs__tab" onClick={() => onChange(it.value)}
        >
          {it.icon}<span>{it.label}</span>{it.count != null && <span className="tabs__count tabular">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge / Chip-like labels */
export function Badge({ tone = 'neutral', size = 'md', icon, children, className }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; size?: 'sm' | 'md'; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return <span className={clsx('badge', `badge--${tone}`, size === 'sm' && 'badge--sm', className)}>{icon}{children}</span>;
}

/** Country as a compact ISO-code chip (Windows has no flag emoji). */
export function CountryChip({ code, name, className }: { code: string; name?: string; className?: string }) {
  return (
    <span className={clsx('country-chip', className)} title={name}>
      <span className="country-chip__code" aria-hidden>{code.toUpperCase()}</span>{name && <span className="country-chip__name">{name}</span>}
    </span>
  );
}

/** Initials avatar – neutral surface, deterministic hue tint (kept subtle). */
export function Avatar({ name, size = 28, color, className }: { name: string; size?: number; color?: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const bg = color ?? `hsl(${h} 26% 36%)`;
  return <span className={clsx('avatar', className)} aria-hidden style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.4) }}>{initials}</span>;
}

/* ------------------------------------------------------------------ Progress */
export interface ProgressRingProps {
  /** 0..1; undefined = indeterminate */
  value?: number;
  size?: number; stroke?: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  children?: ReactNode;
  className?: string;
  label?: string;
}
export function ProgressRing({ value, size = 18, stroke = 2.25, tone = 'accent', children, className, label }: ProgressRingProps) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = value == null ? 0.28 : Math.max(0, Math.min(1, value));
  return (
    <span
      className={clsx('ring', `ring--${tone}`, value == null && 'ring--spin', className)} style={{ width: size, height: size }}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(v * 100)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="ring__bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children && <span className="ring__label">{children}</span>}
    </span>
  );
}
export const Spinner = ({ size = 16, label }: { size?: number; label?: string }) => <ProgressRing size={size} stroke={2} label={label} />;

/** Linear progress. `value` 0..1, undefined = indeterminate. */
export function ProgressBar({ value, tone = 'accent', className, label }: { value?: number; tone?: 'accent' | 'success' | 'warning' | 'danger'; className?: string; label?: string }) {
  return (
    <div className={clsx('pbar', `pbar--${tone}`, value == null && 'pbar--indeterminate', className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}>
      <div className="pbar__fill" style={value == null ? undefined : { transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}

export function Skeleton({ width, height = 14, radius = 6, className, style }: { width?: number | string; height?: number | string; radius?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={clsx('skeleton', className)} aria-hidden style={{ display: 'block', width, height, borderRadius: radius, ...style }} />;
}

/** Uppercase section label (sidebar groups, settings groups). */
export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return <div className={clsx('section-label', className)}><span>{children}</span>{action}</div>;
}
