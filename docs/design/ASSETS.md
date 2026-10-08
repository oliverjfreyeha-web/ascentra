# Art and sound assets

Originals live in `/art-source` (not served). `node scripts/build-art.mjs` builds the served copies.

| Asset | Original | Served as | Source tool |
|---|---|---|---|
| Hero art, glass sculpture | `art-source/hero-glass-sculpture.webp` | `public/art/hero-sculpture-{480,720,960,1060}.{avif,webp}` (cropped to the sculpture) | DaVinci AI |
| Topographic line texture | `art-source/texture-topographic.webp` | Not served since D4 (the old hero background was removed) | DaVinci AI |
| Glass panels card art | `art-source/card-glass-panels.webp` | `public/art/card-glass-{640,960,1280}.{avif,webp}` (desaturated, tinted toward Frozen, darkened) | DaVinci AI |
| Soundtrack "Calm" (58 s) | `art-source/ambient-loop.mp3` | `public/audio/ambient-loop.mp3` (96 kbps MP3, 686 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Focus" (59 s, D2e) | `art-source/focus.mp3` (from `davinci_1__focus__calm_ambient_instrumental_loop__60_secon….mp3`) | `public/audio/focus.mp3` (96 kbps MP3, 698 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Deep study" (58 s, D2e) | `art-source/deep-study.mp3` (from `davinci_2__deep_study__quiet_ambient_instrumental_loop__60….mp3`) | `public/audio/deep-study.mp3` (96 kbps MP3, 677 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Night" (59 s, D2e) | `art-source/night.mp3` (from `davinci_3__night__dark_calm_ambient_instrumental_loop__60_….mp3`) | `public/audio/night.mp3` (96 kbps MP3, 697 KB) | DaVinci AI (AI-generated music) |
| Frost texture (D2d) | — | Removed in D4 (with `scripts/build-frost.mjs`); the liquid glass draws its frost in CSS (an SVG noise filter in `app/styles/glass.css`) | — |
| 3D hero scene (D2d) | — | `app/landing/hero-3d.ts` kept in the repo but no longer loaded by any page since D4 | Modeled in code with three.js (MIT License); no model files, no AI |
| The Hall, landing photo (D4) | `art-source/hall.webp` (1344×752; supplied as hall.png, arrived as WebP) | `public/art/hall-{640,1344}.{avif,webp}`, plus `public/art/hall-sky-mask.png` (sky alpha map) and `public/art/hall-foliage.{avif,webp}` (hedges cut from the photo), built by `scripts/d4-assets.mjs` | AI-generated with Higgsfield (gpt_image_2_5), 2026-10-08 |
| Fireflies (D4) | `art-source/fireflies.png` (1344×752) | `public/art/fireflies-sheet.webp` (36 glows, graded toward firefly yellow-green) and `app/landing/hall/fireflies.json`, built by `scripts/d4-assets.mjs` | AI-generated with Higgsfield, 2026-10-08 |
| Brand mark, favicon and app icons (D3) | — | `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`, `public/icons/icon-{192,512}.png`, `public/icons/maskable-512.png` | Drawn in code from the palette by `scripts/build-brand.mjs`; no AI, no borrowed art |
| Social preview image (D3) | — | `app/opengraph-image.jpg` (1200×630) | Composed in code from the palette, set in Instrument Serif and Geist (`scripts/build-brand.mjs`); no AI |
| Placeholder lesson art (style guide only) | — | `public/art/placeholder-lesson.svg` | Drawn by hand in SVG |

Soundtracks load only after the Ambient sound button is pressed, one at a time (the next is fetched after 30 s of the current one). The list lives in `app/ui/sound/tracks.ts`. The DaVinci AI assets are used under DaVinci AI's terms. The public credits page is `/credits`.

D4 (Higgsfield images): commercial-use terms and any AI-image labeling duties still need counsel review. The page makes no claim that the pictures are real photographs; `/credits` says they are AI-generated illustrations.
