import { Logo } from '@/ui/Logo';

/** Shown while the library index loads. Mirrors the static splash in index.html so the hand-over is invisible. */
export default function Splash() {
  return (
    <div className="splash" role="status" aria-label="ImageWorld">
      <Logo size={56} />
      <div className="splash__word">ImageWorld</div>
      <div className="splash__bar"><i /></div>
    </div>
  );
}
