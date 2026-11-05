import { Check } from 'lucide-react';
import { useT } from '@/i18n';
import { ALBUM_COLORS } from './palette';

export default function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useT();
  return (
    <div className="swatches" role="radiogroup" aria-label={t('albums.color')}>
      {ALBUM_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className="swatch" style={{ background: c }} onClick={() => onChange(c)}>
          {value === c && <Check size={14} strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  );
}
