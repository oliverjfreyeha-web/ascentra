/*
 * D1 · The palette as data, for the style guide's swatches and contrast table. The same values as
 * app/styles/tokens.css; tests/unit/design-tokens.test.ts checks the two agree and that every pair is at least 4.5:1.
 */
export const PALETTE = {
  "color-base": "#080813",
  "color-surface": "#0e0f1f",
  "color-raised": "#161830",
  "color-line": "#2a2d4a",
  "color-line-strong": "#646c90",
  "color-text": "#e8edf5",
  "color-text-muted": "#9aa6ba",
  "color-accent": "#a0bddb",
  "color-accent-strong": "#bdd2e8",
  "color-on-accent": "#080813",
  "color-success": "#8fd9b6",
  "color-warning": "#e8c37e",
  "color-danger": "#f2a7a7",
  "color-demo": "#c9b8f2",
  "color-simulated": "#b4bfd0",
} as const;
export type PaletteName = keyof typeof PALETTE;

export const BACKGROUNDS: PaletteName[] = ["color-base", "color-surface", "color-raised"];
/** Colors used for text (and the accent fill's own text). Each must reach 4.5:1 on every background. */
export const TEXT_COLORS: PaletteName[] = ["color-text", "color-text-muted", "color-accent", "color-accent-strong", "color-success", "color-warning", "color-danger", "color-demo", "color-simulated"];
/** Control borders must reach 3:1 (WCAG 1.4.11); --color-line is decorative only. */
export const CONTROL_BORDERS: PaletteName[] = ["color-line-strong"];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
