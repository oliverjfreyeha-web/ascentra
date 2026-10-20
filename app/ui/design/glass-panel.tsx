import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * Design rebuild D2 · <Glass>: the rebuild's glass panel (class .ds-glass; recipe in app/styles/primitives.css).
 * Frosted by default; Liquid where the nearest data-glass says so, with the lens added by the single page-wide
 * <GlassLens> (Chromium only, never in Lite mode). The rim, gloss and spotlight follow the pointer through the single
 * page-wide <Spotlight> listener, so this component needs no browser code and works in Server Components.
 *   hud     a navigation bar or popover: heavier blur, a slow idle gloss sweep, and it never moves.
 *   widget  a dashboard widget: never tilts.
 *   tilt    a clickable tile or section card only: a small 3D tilt toward the pointer (up to --tilt-max, 8deg), off
 *           with Motion Reduced or Off. Not allowed together with hud or widget.
 * The same look is available as a utility class: className="ds-glass" (plus ds-glass--hud).
 */
type Kind =
  | { hud: true; widget?: never; tilt?: never }
  | { hud?: false; widget: true; tilt?: never }
  | { hud?: false; widget?: false; tilt?: boolean };

export type GlassProps<T extends ElementType> = { as?: T } & Kind & Omit<ComponentPropsWithoutRef<T>, "as">;

export function Glass<T extends ElementType = "div">({ as, hud, widget, tilt, className, ...rest }: GlassProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  const cls = ["ds-glass", hud && "ds-glass--hud", widget && "ds-widget", tilt && !hud && !widget && "ds-tilt", className].filter(Boolean).join(" ");
  return <Tag className={cls} {...rest} />;
}
