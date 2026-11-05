/** ImageWorld mark: a globe whose meridian forms a photo-frame corner + location dot. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
      <circle cx="16" cy="16" r="8.2" stroke="#fff" strokeWidth="1.7" opacity=".95" />
      <ellipse cx="16" cy="16" rx="3.6" ry="8.2" stroke="#fff" strokeWidth="1.5" opacity=".7" />
      <path d="M7.8 16h16.4" stroke="#fff" strokeWidth="1.5" opacity=".7" />
      <circle cx="22.6" cy="9.4" r="3" fill="#fff" />
      <circle cx="22.6" cy="9.4" r="1.15" fill="var(--accent)" />
    </svg>
  );
}
