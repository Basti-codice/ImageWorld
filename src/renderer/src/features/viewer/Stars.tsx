import { useState } from 'react';
import { Star } from 'lucide-react';
import { useT } from '@/i18n';

/** 0–5 star rating. Clicking the current value clears it. */
export default function Stars({ value, onChange }: { value: number; onChange(v: number): void }) {
  const t = useT();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="stars" role="radiogroup" aria-label={t('viewer.rating')} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} aria-label={t('viewer.rating.n', { n })} className="stars__btn" data-on={n <= shown}
          onMouseEnter={() => setHover(n)} onClick={() => onChange(value === n ? 0 : n)}>
          <Star size={18} strokeWidth={1.75} fill={n <= shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}
