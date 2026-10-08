import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * D4 · Liquid glass: a surface of soft light over a shaded, blurred backdrop, with a hairline rim and frost inside the
 * glass (the recipe and its tokens live in app/styles/glass.css). Renders a <div> unless `as` names another element.
 * Never nest more than two levels; text on it keeps at least 4.5:1.
 */
export function Glass<T extends ElementType = "div">({ as, className = "", ...rest }: { as?: T } & ComponentPropsWithoutRef<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={`ui-glass ${className}`.trim()} {...rest} />;
}
