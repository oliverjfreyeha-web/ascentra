# ASCENTRA design reference (approved prototype, rated 10/10 by the Owner)

This folder is a REFERENCE, not code to copy into the app.
The prototype was built as a single-file React 18 page. The real app is Next.js 16 (App Router) + React 19.
Rebuild the design in the app's own structure. Match the look and behavior. Do not copy the layering.

## What is in here
- `prototype/ascentra-prototype-final.html`  Open in Chrome. This is the visual source of truth.
  Try: gear icon (Account) -> Theme (Iris / Mono), Glass (Frosted / Liquid), Motion, Sound.
  Pages: Home, Library, Review, Profile (widgets, activity grid, course tree), Account, Admin.
- `css/prototype-all-layers.css`  Every CSS layer flattened in cascade order (embedded images removed).
- `css/layer03.css` ... `layer17.css`  Same CSS, one file per layer. Later layers override earlier ones on purpose
  (the prototype was tuned in passes). In the app, consolidate into tokens + components. Do not keep 15 layers.
- `src/`  Prototype components: `app13.jsx` (all pages), `Icons.jsx` (original icon set), `Lens.js` (Chromium liquid-glass lens),
  `audio.js` (soft click + reward sounds, Web Audio, no audio files), `cycle.js` + `Hall.jsx` (sky cycle), `Earth.jsx`, `Art3D.jsx`
  (coins, trophies, badges), `Fire.jsx`, `Aurora.*`, `SpecularButton.*`, `CountUp.jsx`.
- `font/`  "Ascentra Display" (original font made for this project; caps-only). `AscentraSemi.woff2` is the one in use.
  `mk.py` regenerates it (fontTools + shapely).
- Not included on purpose: Earth textures (source/licence unverified) and hall photos (already in the repo under public/art).

## Load-bearing facts
- Two themes: `Iris` (deep blue-violet) and `Mono` (black/gray with one warm-white flashlight). Set as `data-theme` on the app root.
- Two glass types: `Frosted` (default) and `Liquid` (Chromium only; falls back to blur elsewhere). Set as `data-glass`.
- Motion levels `full | reduced | off` set as `data-reduced`. The OS reduced-motion setting is always respected.
- Everything in the prototype that looks like data (points, rank, streak, activity, trophies) is DEMO data and is labeled.
  In the real app, show only real data or keep a visible "Demo" / "Simulated" label.
- The hall photo keeps its original colors in both themes.
