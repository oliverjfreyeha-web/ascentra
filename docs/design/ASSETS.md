# Art and sound assets

Originals live in `/art-source` (not served). `node scripts/build-art.mjs` builds the served copies.

| Asset | Original | Served as | Source tool |
|---|---|---|---|
| Hero art, glass sculpture | `art-source/hero-glass-sculpture.webp` | `public/art/hero-sculpture-{480,720,960,1060}.{avif,webp}` (cropped to the sculpture) | DaVinci AI |
| Topographic line texture | `art-source/texture-topographic.webp` | `public/art/texture-topo-{800,1280,2000}.{avif,webp}` | DaVinci AI |
| Glass panels card art | `art-source/card-glass-panels.webp` | `public/art/card-glass-{640,960,1280}.{avif,webp}` (desaturated, tinted toward Frozen, darkened) | DaVinci AI |
| Ambient music loop (58 s) | `art-source/ambient-loop.mp3` | `public/audio/ambient-loop.mp3` (96 kbps MP3, loaded only after the sound toggle is pressed) | DaVinci AI |
| Placeholder lesson art (style guide only) | — | `public/art/placeholder-lesson.svg` | Drawn by hand in SVG |

All AI-generated assets are used under DaVinci AI's terms. The public credits page is `/credits`.
