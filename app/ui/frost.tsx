/**
 * D2d · Frost: the "frost" variant of the D1 frosted panel. Ice crystals creep in from a card's edges and corners
 * while the middle stays clear. Decorative (aria-hidden), painted behind the card's content. Landing cards and
 * decorative panels only: never behind body text, never on lesson, billing, Privacy Center or admin screens.
 * Strength: the --frost-strength token in app/styles/tokens.css.
 */
export function Frost({ className = "" }: { className?: string }) {
  return <span className={`frost ${className}`.trim()} aria-hidden="true" />;
}
