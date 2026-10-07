import Image from "next/image";

/**
 * D2b: a slot for art from /public/art. Raster art is optimized by next/image (sized, lazy, modern formats); while it
 * loads, a quiet textured placeholder holds the space so nothing shifts. Placeholder art is labeled as such until the
 * final art replaces it.
 */
export function ArtSlot({ src, alt, ratio = "4 / 3", sizes = "(max-width: 48rem) 100vw, 40vw", placeholder = false, priority = false }: {
  src: string; alt: string; ratio?: string; sizes?: string; placeholder?: boolean; priority?: boolean;
}) {
  return (
    <figure className="ui-art" style={{ aspectRatio: ratio }}>
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} unoptimized={src.endsWith(".svg")} className="ui-art__img" />
      {placeholder && <figcaption className="ui-art__tag">Placeholder art</figcaption>}
    </figure>
  );
}
