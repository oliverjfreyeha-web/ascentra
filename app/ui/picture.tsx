/**
 * D2c: art pre-optimized by scripts/build-art.mjs (AVIF first, WebP fallback, responsive widths) with its real width and
 * height, so the browser reserves the space and picks the smallest file that fits.
 */
export type ArtSet = { base: string; widths: readonly number[]; width: number; height: number };

export const ART = {
  heroSculpture: { base: "/art/hero-sculpture", widths: [480, 720, 960, 1060], width: 1060, height: 1060 },
  textureTopo: { base: "/art/texture-topo", widths: [800, 1280, 1600, 2000], width: 2000, height: 1116 },
  cardGlass: { base: "/art/card-glass", widths: [640, 960, 1280, 1600, 2000], width: 2000, height: 1116 },
} as const satisfies Record<string, ArtSet>;

export const srcSet = (a: ArtSet, ext: "avif" | "webp") => a.widths.map((w) => `${a.base}-${w}.${ext} ${w}w`).join(", ");

export function Picture({ art, sizes, alt = "", className, priority = false }: { art: ArtSet; sizes: string; alt?: string; className?: string; priority?: boolean }) {
  const largest = (a: ArtSet) => a.widths[a.widths.length - 1];
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={srcSet(art, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(art, "webp")} sizes={sizes} />
      <img src={`${art.base}-${largest(art)}.webp`} alt={alt} width={art.width} height={art.height} decoding="async"
        loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} />
    </picture>
  );
}
