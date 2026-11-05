import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Compass, Flame, Globe, Images, Lasso, Layers, Map as MapIcon, Maximize2, Minus, Plus, SquareDashed, Circle, Check } from 'lucide-react';
import type { MapProjection, MapStyleId } from '@shared/types';
import { useT } from '@/i18n';
import type { DrawToolId } from './draw';

interface BtnProps { label: string; onClick?: () => void; active?: boolean; children: ReactNode; disabled?: boolean; pressed?: boolean }
function Btn({ label, onClick, active, pressed, children, disabled }: BtnProps) {
  return (
    <button type="button" className="mp-btn" aria-label={label} title={label} aria-pressed={pressed} data-active={active || undefined} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function ToolsBar({ tool, onTool, disabled }: { tool: DrawToolId | null; onTool: (t: DrawToolId | null) => void; disabled?: boolean }) {
  const t = useT();
  const items: Array<{ id: DrawToolId; icon: ReactNode; label: string }> = [
    { id: 'rect', icon: <SquareDashed size={17} strokeWidth={1.75} />, label: t('map.tool.rect') },
    { id: 'lasso', icon: <Lasso size={17} strokeWidth={1.75} />, label: t('map.tool.lasso') },
    { id: 'circle', icon: <Circle size={16} strokeWidth={1.75} strokeDasharray="3 2.4" />, label: t('map.tool.circle') },
  ];
  return (
    <div className="mp-ctl mp-ctl--row glass" role="toolbar" aria-label={t('map.selection.title')}>
      {items.map((i) => (
        <Btn key={i.id} label={i.label} pressed={tool === i.id} active={tool === i.id} disabled={disabled} onClick={() => onTool(tool === i.id ? null : i.id)}>{i.icon}</Btn>
      ))}
    </div>
  );
}

interface CtlProps {
  projection: MapProjection; styleId: MapStyleId; dark: boolean; heatmap: boolean; thumbs: boolean; bearing: number;
  onZoom(d: number): void; onNorth(): void; onFit(): void; onProjection(): void; onStyle(s: MapStyleId): void; onHeatmap(): void; onThumbs(): void;
}

export function MapControls(p: CtlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); } };
    window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);

  const std = p.styleId === 'dark' || p.styleId === 'light';
  const options: Array<{ id: MapStyleId; label: string; on: boolean; online?: boolean }> = [
    { id: p.dark ? 'dark' : 'light', label: t('map.style.standard'), on: std },
    { id: 'satellite', label: t('map.style.satellite'), on: p.styleId === 'satellite', online: true },
    { id: 'voyager', label: t('map.style.voyager'), on: p.styleId === 'voyager', online: true },
  ];

  return (
    <div className="mp-top mp-top--right">
      <div className="mp-ctl glass">
        <Btn label={t('map.zoomIn')} onClick={() => p.onZoom(1)}><Plus size={17} strokeWidth={1.75} /></Btn>
        <Btn label={t('map.zoomOut')} onClick={() => p.onZoom(-1)}><Minus size={17} strokeWidth={1.75} /></Btn>
        <div className="mp-ctl__sep" />
        <Btn label={t('map.north')} onClick={p.onNorth}>
          <Compass size={17} strokeWidth={1.75} style={{ transform: `rotate(${-p.bearing - 45}deg)`, transition: 'transform 120ms linear' }} />
        </Btn>
      </div>
      <div className="mp-ctl glass">
        <Btn label={p.projection === 'globe' ? t('map.projection.toFlat') : t('map.projection.toGlobe')} onClick={p.onProjection}>
          {p.projection === 'globe' ? <MapIcon size={17} strokeWidth={1.75} /> : <Globe size={17} strokeWidth={1.75} />}
        </Btn>
        <Btn label={t('map.fit')} onClick={p.onFit}><Maximize2 size={16} strokeWidth={1.75} /></Btn>
      </div>
      <div className="mp-ctl glass">
        <div className="mp-pop-anchor" ref={popRef}>
          <Btn label={t('map.style')} pressed={open} active={open} onClick={() => setOpen((o) => !o)}><Layers size={17} strokeWidth={1.75} /></Btn>
          {open && (
            <div className="mp-pop glass" role="menu" aria-label={t('map.style')}>
              {options.map((o) => (
                <button key={o.id} role="menuitemradio" aria-checked={o.on} className="mp-style" data-on={o.on || undefined} onClick={() => { p.onStyle(o.id); }}>
                  <span className={`mp-style__sw mp-style__sw--${o.id === 'dark' || o.id === 'light' ? (p.dark ? 'dark' : 'light') : o.id}`} />
                  <span className="mp-style__l">{o.label}{o.online && <small title={t('map.style.online')}>online</small>}</span>
                  {o.on && <Check size={15} strokeWidth={2} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <Btn label={t('map.heatmap')} pressed={p.heatmap} active={p.heatmap} onClick={p.onHeatmap}><Flame size={17} strokeWidth={1.75} /></Btn>
        <Btn label={t('map.thumbs')} pressed={p.thumbs} active={p.thumbs} onClick={p.onThumbs}><Images size={17} strokeWidth={1.75} /></Btn>
      </div>
    </div>
  );
}
