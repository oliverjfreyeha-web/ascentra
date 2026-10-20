/**
 * Design rebuild D1 · The ASCENTRA icon set, ported from design-reference/src/Icons.jsx (original 24px drawings).
 * Three layers per icon: f = soft tint fill, l = main line, a = accent line, each painted with a gradient that is
 * defined once for the whole page by <IconDefs /> (rendered in the root layout). The gradient colors are theme
 * tokens (--icon-*), so icons follow Iris or Mono. No hooks and no browser APIs: safe in Server and Client Components.
 * Hover animations live in app/styles/design.css and stop when html[data-reduced="1"] or the device asks for less motion.
 * Decorative by default (aria-hidden); pass a title when the icon carries meaning on its own.
 */
import type { SVGProps } from "react";

const GEAR = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12l2-1-2-4-2 1a7 7 0 0 0-2-1l-.5-2h-4L10 7a7 7 0 0 0-2 1L6 7 4 11l2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a7 7 0 0 0 2 1l.5 2h4l.5-2a7 7 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 0-2";
const rect = (x: number, y: number, w: number, h: number, r = 1.5) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}z`;

type Glyph = { f?: string; l?: string; a?: string; w?: number };

export const ICONS = {
  home: { f: "M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", l: "M3 11.5l9-8 9 8M6 10v9.5h12V10", a: "M10 20v-4.4a2 2 0 0 1 4 0V20" },
  book: { f: "M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z", l: "M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16zM5 16a3.5 3.5 0 0 1 3.5-3.5H19", a: "M9 8h5" },
  repeat: { l: "M17 3l3.5 3.5L17 10M4 11V9.5a3 3 0 0 1 3-3h13.5M7 21l-3.5-3.5L7 14M20 13v1.5a3 3 0 0 1-3 3H3.5", a: "M10.5 12h3" },
  grid: { f: rect(4, 4, 6.5, 6.5) + rect(13.5, 4, 6.5, 6.5) + rect(4, 13.5, 6.5, 6.5), l: rect(4, 4, 6.5, 6.5) + rect(13.5, 4, 6.5, 6.5) + rect(4, 13.5, 6.5, 6.5), a: rect(13.5, 13.5, 6.5, 6.5) },
  upload: { l: "M12 15.5V4M7.5 8.5L12 4l4.5 4.5", a: "M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" },
  tag: { f: "M3.5 12.5v-8h8l9 9a1 1 0 0 1 0 1.4l-6.1 6.1a1 1 0 0 1-1.4 0z", l: "M3.5 12.5v-8h8l9 9a1 1 0 0 1 0 1.4l-6.1 6.1a1 1 0 0 1-1.4 0z", a: "M8 8.2h.01", w: 2.2 },
  check: { f: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z", l: "M7.8 12.4l3 3 5.6-6.4", a: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z" },
  users: { f: "M9 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z", l: "M2.5 20v-1.5a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4V20M9 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z", a: "M17 4a3.5 3.5 0 0 1 0 6.6M21.5 20v-1.5a4 4 0 0 0-3-3.9" },
  card: { f: rect(3, 5, 18, 14), l: rect(3, 5, 18, 14) + "M3 10h18", a: "M6.5 15h4" },
  shield: { f: "M12 2.8l7.5 2.7v6c0 4.7-3.2 7.8-7.5 9-4.3-1.2-7.5-4.3-7.5-9v-6z", l: "M12 2.8l7.5 2.7v6c0 4.7-3.2 7.8-7.5 9-4.3-1.2-7.5-4.3-7.5-9v-6z", a: "M8.8 12l2.4 2.4 4-4.4" },
  gear: { f: "M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z", l: GEAR, a: "M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z" },
  user: { f: "M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", l: "M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", a: "M4.5 20.5v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1" },
  back: { l: "M14.5 5.5L8 12l6.5 6.5" },
  film: { f: rect(4, 5, 16, 14), l: rect(4, 5, 16, 14) + "M9 5v14M15 5v14", a: "M4 9.5h5M4 14.5h5M15 9.5h5M15 14.5h5" },
  note: { f: "M6 3.5h8.5L19 8v12.5H6z", l: "M6 3.5h8.5L19 8v12.5H6zM14.5 3.5V8H19", a: "M9 12.5h7M9 16h5" },
  star: { f: "M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z", l: "M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z", a: "M12 7.2v4.2" },
  flame: { f: "M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z", l: "M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z", a: "M12 19a2.4 2.4 0 0 0 2.4-2.4c0-1.5-1.4-2.2-2.4-3.8-1 1.6-2.4 2.3-2.4 3.8A2.4 2.4 0 0 0 12 19z" },
  bolt: { f: "M13 2L4 14h7l-1 8 9-12h-7z", l: "M13 2L4 14h7l-1 8 9-12h-7z", a: "M19.5 3.5v3M18 5h3" },
  mail: { f: rect(3, 5, 18, 14), l: rect(3, 5, 18, 14), a: "M3.6 7.5L12 13.5l8.4-6" },
  dots: { l: "M12 5.5h.01M12 12h.01M12 18.5h.01", w: 3.2 },
  trophy: { f: "M7 4h10v5a5 5 0 0 1-10 0z", l: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11M12 14v4M8.5 20h7", a: "M9.8 6.6v2.4" },
  map: { f: "M3 6.5l6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5z", l: "M3 6.5l6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5z", a: "M9 4v13.5M15 6.5V20" },
  plus: { l: "M12 5v14M5 12h14" },
  x: { l: "M6 6l12 12M18 6L6 18" },
  chat: { f: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4V16A1.5 1.5 0 0 1 4 14.5z", l: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4V16A1.5 1.5 0 0 1 4 14.5z", a: "M8 8.5h8M8 12h5" },
  chart: { f: "M5 13h3v7H5zM10.5 8h3v12h-3zM16 4.5h3V20h-3z", l: "M5 13h3v7H5zM10.5 8h3v12h-3zM16 4.5h3V20h-3z", a: "M3.5 20.5h17" },
  target: { f: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", l: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", a: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 12h.01" },
  search: { f: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", l: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", a: "M15.5 15.5L20 20" },
  clock: { f: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", l: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", a: "M12 7v5l3 2" },
  lock: { f: rect(5, 10.5, 14, 10), l: rect(5, 10.5, 14, 10) + "M8 10.5V8a4 4 0 0 1 8 0v2.5", a: "M12 15v2" },
  refresh: { l: "M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** The ids of the shared gradients. Prefixed so they never collide with other SVGs on the page. */
const G = { line: "asc-ic-line", accent: "asc-ic-accent", fill: "asc-ic-fill" } as const;

type IconProps = { name: IconName; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "name" | "children">;

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  const d: Glyph = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round"
      className={`ds-icon ds-icon--${name}${className ? ` ${className}` : ""}`}
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false" {...rest}>
      {title && <title>{title}</title>}
      {d.f && <path className="ds-icon__f" d={d.f} fill={`url(#${G.fill})`} stroke="none" />}
      {d.a && <path className="ds-icon__a" pathLength={1} d={d.a} stroke={`url(#${G.accent})`} strokeWidth={1.9} />}
      {d.l && <path className={`ds-icon__l${d.w ? " ds-icon__dot" : ""}`} pathLength={1} d={d.l} stroke={`url(#${G.line})`} strokeWidth={d.w ?? 1.7} />}
      {d.l && !d.w && <path className="ds-icon__hi" d={d.l} transform="translate(-.3 -.3)" />}
    </svg>
  );
}

/**
 * The three gradients every icon uses, defined once (render a single <IconDefs /> per page; the root layout does).
 * Not display:none, which would stop browsers painting the gradients; it takes no space and is hidden from assistive tech.
 */
export function IconDefs() {
  const stop = (offset: string, color: string) => <stop offset={offset} style={{ stopColor: `var(${color})` }} />;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id={G.line} gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          {stop("0", "--icon-line-1")}{stop(".55", "--icon-line-2")}{stop("1", "--icon-line-3")}
        </linearGradient>
        <linearGradient id={G.accent} gradientUnits="userSpaceOnUse" x1="2" y1="22" x2="22" y2="2">
          {stop("0", "--icon-accent-1")}{stop(".6", "--icon-accent-2")}{stop("1", "--icon-accent-3")}
        </linearGradient>
        <linearGradient id={G.fill} gradientUnits="userSpaceOnUse" x1="12" y1="2" x2="12" y2="22">
          {stop("0", "--icon-fill-1")}{stop("1", "--icon-fill-2")}
        </linearGradient>
      </defs>
    </svg>
  );
}
