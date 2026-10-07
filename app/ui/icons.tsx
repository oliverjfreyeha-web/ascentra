import type { SVGProps } from "react";

/**
 * D2b: ASCENTRA's line icons. 24px grid, 1.5px stroke, round joins, drawn for this app. Decorative by default
 * (aria-hidden); pass a title for an icon that carries meaning on its own.
 */
const PATHS = {
  cite: "M5 7h4v4H6.5a1.5 1.5 0 0 0-1.5 1.5V17M13 7h4v4h-2.5a1.5 1.5 0 0 0-1.5 1.5V17M4 20h16",
  mentor: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4h-.5A1.5 1.5 0 0 1 4 14.5zM9 9h6M9 12h4",
  path: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7",
  practice: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  privacy: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9.5 12l1.8 1.8L15 10",
  family: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20a5.5 5.5 0 0 1 11 0M17 12a2.5 2.5 0 1 0 0-5M16.5 15.5A4.5 4.5 0 0 1 21 20",
  verified: "M12 3l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1zM9 12l2 2 4-4",
  sources: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13zM7 8h1M16 8h1",
  arrow: "M5 12h14M13 6l6 6-6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, title, size = 24, ...rest }: { name: IconName; title?: string; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      className="ui-icon" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} {...rest}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
