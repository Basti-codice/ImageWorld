import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { t } from '@/i18n';
import { Button } from '@/ui';

interface Props {
  children: ReactNode;
  /** when this value changes the boundary recovers (e.g. the current view) */
  resetKey?: unknown;
  /** render nothing instead of the error panel (overlays, optional widgets) */
  silent?: boolean;
  /** full-window crash screen (root boundary) */
  fatal?: boolean;
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ImageWorld] render error', error, info.componentStack); }
  componentDidUpdate(prev: Props) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return <CrashPanel error={error} fatal={this.props.fatal} onRetry={() => this.setState({ error: null })} />;
  }
}

export function CrashPanel({ error, fatal, onRetry }: { error: unknown; fatal?: boolean; onRetry?: () => void }) {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    <div className={fatal ? 'crash crash--fatal' : 'crash'} role="alert">
      <div className="crash__icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
      <h2>{t('error.title')}</h2>
      <p>{t('error.body')}</p>
      <div className="crash__actions">
        {onRetry && !fatal && <Button onClick={onRetry}>{t('error.retry')}</Button>}
        <Button variant="primary" onClick={() => location.reload()}>{t('error.reload')}</Button>
      </div>
      <details className="crash__details selectable"><summary>{t('error.details')}</summary><pre>{msg}</pre></details>
    </div>
  );
}
