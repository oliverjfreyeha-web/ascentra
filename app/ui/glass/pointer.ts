/**
 * Design rebuild D2 · The pointer's position over one surface, as the CSS reads it: x/y inside the box (px), the rim
 * angle pointing at the pointer (deg, 0 = up, clockwise, as conic-gradient "from"), and tx/ty from -1 to 1 for the tilt.
 * Pure, for tests; app/ui/spotlight.tsx applies it.
 */
export function pointerVars(r: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const x = clientX - r.left, y = clientY - r.top;
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const angle = Math.round(((Math.atan2(y - h / 2, x - w / 2) * 180) / Math.PI + 90 + 360) % 360);
  return { x: Math.round(x), y: Math.round(y), angle, tx: clamp((x / w) * 2 - 1), ty: clamp((y / h) * 2 - 1) };
}
