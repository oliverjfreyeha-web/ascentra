# Art and sound assets

Originals live in `/art-source` (not served). `node scripts/build-art.mjs` builds the served copies.

| Asset | Original | Served as | Source tool |
|---|---|---|---|
| Hero art, glass sculpture | `art-source/hero-glass-sculpture.webp` | `public/art/hero-sculpture-{480,720,960,1060}.{avif,webp}` (cropped to the sculpture) | DaVinci AI |
| Topographic line texture | `art-source/texture-topographic.webp` | `public/art/texture-topo-{800,1280,2000}.{avif,webp}` | DaVinci AI |
| Glass panels card art | `art-source/card-glass-panels.webp` | `public/art/card-glass-{640,960,1280}.{avif,webp}` (desaturated, tinted toward Frozen, darkened) | DaVinci AI |
| Soundtrack "Calm" (58 s) | `art-source/ambient-loop.mp3` | `public/audio/ambient-loop.mp3` (96 kbps MP3, 686 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Focus" (59 s, D2e) | `art-source/focus.mp3` (from `davinci_1__focus__calm_ambient_instrumental_loop__60_secon….mp3`) | `public/audio/focus.mp3` (96 kbps MP3, 698 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Deep study" (58 s, D2e) | `art-source/deep-study.mp3` (from `davinci_2__deep_study__quiet_ambient_instrumental_loop__60….mp3`) | `public/audio/deep-study.mp3` (96 kbps MP3, 677 KB) | DaVinci AI (AI-generated music) |
| Soundtrack "Night" (59 s, D2e) | `art-source/night.mp3` (from `davinci_3__night__dark_calm_ambient_instrumental_loop__60_….mp3`) | `public/audio/night.mp3` (96 kbps MP3, 697 KB) | DaVinci AI (AI-generated music) |
| Frost texture (D2d) | — | `public/art/frost.webp` (768 px, grayscale) | Generated in code by `scripts/build-frost.mjs` (branching crystals, fractal noise, hairline cracks); no AI |
| 3D hero scene (D2d) | — | `app/landing/hero-3d.ts` (glass blocks, metal ring, particles, light panels) | Modeled in code with three.js (MIT License); no model files, no AI |
| Placeholder lesson art (style guide only) | — | `public/art/placeholder-lesson.svg` | Drawn by hand in SVG |

Soundtracks load only after the Ambient sound button is pressed, one at a time (the next is fetched after 30 s of the current one). The list lives in `app/ui/sound/tracks.ts`. All AI-generated assets are used under DaVinci AI's terms. The public credits page is `/credits`.
