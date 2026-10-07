import { Frost } from "../ui/frost";

const TILES = ["Aurora", "Ripple", "Glass", "Spotlight"] as const;

/**
 * D2d: a row of four small, dark glass tiles below the hero, each a soft Frozen-colored effect drawn in CSS. They stay
 * still until hovered (and always with reduced motion). Purely decorative, so hidden from assistive technology.
 */
export function EffectTiles() {
  return (
    <div className="fx-row" aria-hidden="true">
      {TILES.map((name) => (
        <div key={name} className={`fx-tile fx-tile--${name.toLowerCase()}`}>
          <span className="fx-tile__art"><span /></span>
          {name === "Glass" && <Frost className="frost--tile" />}
          <span className="fx-tile__name">{name}</span>
        </div>
      ))}
    </div>
  );
}
