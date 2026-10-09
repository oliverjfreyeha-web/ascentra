# Image provenance

The full asset list (art, sound, brand) is in [docs/design/ASSETS.md](design/ASSETS.md). This file records the D4 images.

| Image | Where it is used | Origin | Date |
|---|---|---|---|
| The Hall (`art-source/hall.webp`, 1344×752; supplied as hall.png) | Landing first screen, served as `public/art/hall-*`, with a sky mask and a foliage layer cut from it by `scripts/d4-assets.mjs` | AI-generated with Higgsfield (gpt_image_2_5) | 2026-10-08 |
| Fireflies (`art-source/fireflies.png`, 1344×752) | The landing's firefly glows, `public/art/fireflies-sheet.webp` | AI-generated with Higgsfield | 2026-10-08 |

Open for counsel: Higgsfield's commercial-use terms for these images, and any AI-image labeling duties. The site does not claim the pictures are real photographs; `/credits` says they were generated with AI and are illustrations, not photographs of a real building.

## D5 wallpapers

| File | What it shows | Source | Note |
|---|---|---|---|
| `public/env/reef-{1920,1080}.webp` (from `art-source/env-reef.webp`) | Aerial view of a shallow turquoise coral reef with rays and fish | Provided by the Owner. Original source and license NOT confirmed | The Owner must confirm the origin and commercial-use rights before launch |
| `public/env/lake-{1920,1080}.webp` (from `art-source/env-lake.webp`) | A turquoise alpine lake reflecting snow-capped peaks at golden hour, larch trees on the right | Provided by the Owner. Original source and license NOT confirmed | The Owner must confirm the origin and commercial-use rights before launch |
| `public/env/mist-{1920,1080}.webp` (from `art-source/env-mist.webp`) | A dark mountain face in drifting cloud, one sunlit patch near the summit, forest below | Provided by the Owner. Original source and license NOT confirmed | The Owner must confirm the origin and commercial-use rights before launch |
| `public/env/sun-{1920,1080}.webp` (from `art-source/env-sun.webp`) | A snowy mountain range at sunrise, the sun and its flare at the upper right | Provided by the Owner. Original source and license NOT confirmed | The Owner must confirm the origin and commercial-use rights before launch |

Built by `scripts/d5-env-assets.mjs` (WebP, 1920 px at quality 78 and 1080 px at quality 72). The water, fog, light and particle motion over them is drawn in code (`app/env/env-gl.ts`).
