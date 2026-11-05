import { Logo } from '@/ui/Logo';
import SearchBox from '@/features/search/SearchBox';
import { useLibrary } from '@/state/library';

export default function Titlebar() {
  const progress = useLibrary((s) => s.progress);
  const busy = Object.values(progress)[0];
  return (
    <header className="titlebar drag">
      <div className="titlebar__brand"><Logo /><span>ImageWorld</span></div>
      <div className="titlebar__center"><div className="no-drag"><SearchBox /></div></div>
      <div className="titlebar__right no-drag" style={{ color: 'var(--text-3)', fontSize: 12 }}>{busy ? `${busy.done}/${busy.total}` : null}</div>
    </header>
  );
}
