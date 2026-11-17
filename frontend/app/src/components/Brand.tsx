/**
 * Riona's mark, the hero figure in miniature: an orange entry (RIO, flow) resting on the ink record it feeds
 * (NA, structure). Drawn, not a glyph, so it stays crisp at every size.
 */
export function RionaMark({ size = 18, ink = 'currentColor' }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 9.2l8.6 4.3L10 17.8l-8.6-4.3z" fill={ink} />
      <path d="M10 2.6l6.2 3.1L10 8.8 3.8 5.7z" fill="#EF582E" />
    </svg>
  );
}

/** The lowercase wordmark used in the top bars and on the public site. */
export function Wordmark({ href, className = 'wordmark', size }: { href: string; className?: string; size?: number }) {
  return (
    <a href={href} className={className} aria-label="Riona, home">
      <RionaMark size={size} />
      <span>riona</span>
    </a>
  );
}

/** "⌘K" on Apple platforms, "Ctrl K" everywhere else. */
export const shortcutLabel = () => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K');
