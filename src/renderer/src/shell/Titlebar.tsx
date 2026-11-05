import { Logo } from '@/ui/Logo';
import SearchBox from '@/features/search/SearchBox';
import SyncStatus from './SyncStatus';
import { ErrorBoundary } from './ErrorBoundary';

/** 44 px window header. Windows 11 caption buttons are native (titleBarOverlay) – the right padding in shell.css reserves their space. */
export default function Titlebar({ minimal }: { minimal?: boolean }) {
  return (
    <header className="titlebar drag">
      <div className="titlebar__brand"><Logo size={22} /><span className="titlebar__name">ImageWorld</span></div>
      <div className="titlebar__center">{!minimal && <div className="titlebar__slot no-drag"><ErrorBoundary silent><SearchBox /></ErrorBoundary></div>}</div>
      <div className="titlebar__right no-drag">{!minimal && <SyncStatus />}</div>
    </header>
  );
}
