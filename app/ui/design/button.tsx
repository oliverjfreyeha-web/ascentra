import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./ds-icon";

/**
 * Design rebuild D2 · <Button>. Press = scale .965 in 120 ms; visible 2px focus ring, also on glass.
 *   glass    the glass panel recipe (Frosted, or Liquid where chosen) as a button.
 *   primary  NOT glass: the slow iridescent gradient in Iris, warm champagne in Mono, with our own specular highlight
 *            (a soft hotspot that follows the pointer and a lit top edge; light only, nothing moves).
 *   icon     a square glass button with just an icon; `label` is required and becomes its accessible name.
 * Plain markup and CSS (app/styles/primitives.css), so it works in Server and Client Components. data-sfx names the
 * small sound it makes when UI sounds are on (app/ui/sound/ui-sounds.ts); "none" for silence.
 */
type Common = { size?: "sm" | "md" | "lg"; sfx?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;
export type ButtonProps =
  | (Common & { variant?: "glass" | "primary"; icon?: IconName; label?: never; children: ReactNode })
  | (Common & { variant: "icon"; icon: IconName; label: string; children?: never });

export function Button(props: ButtonProps) {
  const { variant = "glass", size = "md", icon, label, children, className, sfx, type = "button", ...rest } = props;
  const cls = [
    "ds-btn",
    `ds-btn--${variant}`,
    size !== "md" && `ds-btn--${size}`,
    variant !== "primary" && "ds-glass",
    className,
  ].filter(Boolean).join(" ");
  const iconSize = size === "sm" ? 16 : size === "lg" ? 22 : 18;
  return (
    <button type={type} className={cls} aria-label={variant === "icon" ? label : undefined} data-sfx={sfx ?? (variant === "icon" ? "open" : "tap")} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {variant !== "icon" && <span>{children}</span>}
    </button>
  );
}
