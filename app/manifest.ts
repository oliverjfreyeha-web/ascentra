import type { MetadataRoute } from "next";

/** D3 · App icons and colors for "Add to Home Screen" (built by scripts/build-brand.mjs from the palette). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ASCENTRA",
    short_name: "ASCENTRA",
    description: "ASCENTRA · Foundations in progress",
    start_url: "/",
    display: "browser",
    background_color: "#080813",
    theme_color: "#080813",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
