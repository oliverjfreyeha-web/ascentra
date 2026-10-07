/** D2c: a registration crosshair for corners of landing sections. Decorative (aria-hidden), low contrast. */
export function Crosshair({ className }: { className: string }) {
  return (
    <svg className={`hud-cross ${className}`} width="21" height="21" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <path d="M10.5 0v8M10.5 13v8M0 10.5h8M13 10.5h8" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="10.5" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
