# D2 · Primitives report (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only, additive, no page restyles. Decisions as in [`decisions.md`](decisions.md).

## Start-of-stage check

Before any D2 change: lint, typecheck, build, unit tests (4221) and the Chromium component tests (110) all passed, so CI
would have gone green (`design-reference/` excluded). The database and integration tests need Postgres and were not
run here; D1 and D2 touch nothing under `db/`.

## What was built

| # | Primitive | Where | Notes |
|---|---|---|---|
| 1 | `<Glass>` + `.ds-glass` | `app/ui/design/glass-panel.tsx`, `app/styles/primitives.css` | Frosted recipe (DESIGN.md), 1.25px conic rim that turns toward the pointer (`--ds-ang`, a registered `<angle>` so it eases), gloss layer (sweep band, diagonal reflection, top wash, pointer spotlight, floor glow). `hud`: heavier blur, slow idle gloss sweep (9s), faster on hover or focus (2.4s), never moves. `widget`: never tilts. Server-safe (no browser code). |
| — | One pointer listener | `app/ui/spotlight.tsx` (extended) + `app/ui/glass/pointer.ts` | The existing single page-wide listener now also sets `--mx/--my`, `--ds-ang` and tilt `--tx/--ty` on the rebuild's surfaces. One listener for the page, rAF-throttled, nothing set while `data-reduced="1"`. |
| 2 | Liquid lens | `app/ui/glass-lens.tsx` (extended) + `app/ui/glass/lens-core.ts` | No second glass system. The existing lens now runs through a tested controller: `<Glass>` gets the prototype's shape (≈26px bezel, scale 32, dispersion 1 / .96 / .92), **Chromium only** (client hints or UA, plus `CSS.supports`), never in Lite mode. Each element follows its **nearest** `data-glass`. Blur is applied **before** the lens (`blur(5px) url(#…) saturate(1.5) brightness(1.08)`). Fallback without the lens: `blur(9px) saturate(170%)`. **Frosted removes every filter, every `--lg` and every `data-lens`.** ResizeObserver per lens, unobserved on detach; cleanup on unmount; **max 24 filters**. Glass buttons never get a lens. The D5 surfaces keep their own numbers. |
| 3 | `<Button>`, `<Segmented>` | `app/ui/design/button.tsx`, `segmented.tsx` | `glass`, `primary`, `icon` (label required, becomes the accessible name). Press scale .965 in 120ms. 2px focus ring visible on glass. Iridescence **only** on `primary` (slow drift in Iris, 3s on hover; warm champagne in Mono). Our own specular highlight: a pointer hotspot plus a lit top edge (light only). Segmented: pearl in Iris, champagne in Mono. |
| 4 | Motion | `primitives.css` | `.ds-stagger` (rise 26px, scale .965 → 1, 60ms steps, up to 12), `.ds-rise`, `.ds-drop`, `.ds-draw` (path draw-in), `ds-gloss` via `@property --ds-gl`, `ds-irid` (background position). All gated by `:root:not([data-reduced="1"])` and off under `prefers-reduced-motion`. Numbers use the app's own `CountUp`, which now also respects `data-reduced`. |
| 5 | UI sounds | `app/ui/sound/ui-sounds.ts`, `ui-sound-clicks.tsx` | Clicks and a reward chime from `audio.js`, Web Audio only. Off by default; never autoplays (nothing is created before the page's first real press); independent of motion. The switch is stored in the **existing** sound preference (`ascentra.sound`, field `effects`); the ambient player now keeps that field when it saves. Only controls with `data-sfx` make a sound. |
| 6 | Lite mode | `app/env/prefs.ts`, `tokens.css`, `primitives.css` | New preference `effects`: `auto` (default) or `full` ("Always full"). `data-lite="1"` is set **before first paint** on phone widths (≤760px), ≤4 cores or Save-Data, unless `full`. Lite: no lens, Liquid falls back to frosted, lighter blur (HUD 16px, panels 10px). 3D pieces will read `data-lite` when they arrive. |
| 7 | Tilt | `.ds-tilt` (`<Glass tilt>`) | Up to `--tilt-max` (8°) toward the pointer, only on clickable tiles and section cards; TypeScript forbids `tilt` with `hud` or `widget`, and CSS forces them flat. `--tilt-max` is 0 when motion is Reduced or Off. |

`/dev/design` now shows every primitive in **both themes × both glass types** at once: each theme board has a Frosted
region and a Liquid region over a busy backdrop. It also has page controls for Effects (Lite) and UI sounds, a reward
sound button, entrance replay, a draw-in path and CountUp.

## Tests

- **Unit** (`tests/unit/lens-core.test.ts`, new): attach (one filter, mark and observer each), `clear()` removes all,
  dropped elements lose theirs, max 24, zero-size elements wait for a size, kind change rebuilds; who gets a lens
  (Liquid, Chromium, not Lite, SVG backdrop); Chromium detection (Chrome, Edge yes; Safari, Firefox, iOS no); prototype
  lens shape; pointer maths.
- **Unit** (`tests/unit/ui-sounds.test.ts`, new): off by default, silent before the first press, plays only when on,
  stored in the existing preference, kept by the ambient player, never reads the Motion setting.
- **Unit** (`tests/unit/env-prefs.test.ts`, updated for the new defaults): `effects` default `auto`; boot script sets
  `data-effects` and `data-lite` (phone, few cores, overridden by `full`); Lite rules.
- **Chromium** (`e2e/components/design-primitives.spec.ts`, new, runs in CI's component job): lens on every Liquid
  panel with the blur first; none on buttons or a Frosted region; Frosted removes all filters and inline values; Liquid
  restores them; Lite drops them; max 24 with the fallback on the rest; unmount leaves nothing; **layout shift = 0**
  across entrance, lens attach, glass switching and pointer moves; `data-reduced=1` stops every `ds-` animation and the
  tilt; one listener sets rim angle and spotlight, tilts only the tile, never the HUD. Stable: 63/63 repeated runs.

## Checks

lint ✔ · typecheck ✔ · unit tests 59 files / 4239 ✔ · build ✔ · component tests 117 ✔ · check:bundle ✔ ·
check:build-secrets not run (needs real secrets). Visual check: the real `/dev/design` page, bundled and run in
Chromium with the lens live, screenshotted in both themes; the lens attached to the 8 Liquid panels and to nothing
under Frosted.

## Changes to existing files (and why)

- `app/globals.css`, `app/styles/polish.css`: the legacy plain-`button` rules now skip `ds-` buttons
  (`:not([class*="ds-"])`). Without this they out-ranked the new buttons, which rendered dark. No existing button has a
  `ds-` class, so current screens are unchanged.
- `app/ui/glass-lens.tsx`: rewired onto the controller (above). One visible difference on existing screens: none.
  Internally, Frosted now really removes the D5 filters instead of leaving them unused.
- `app/ui/spotlight.tsx`, `app/ui/count-up.tsx`, `app/ui/sound/engine.ts`, `app/env/prefs.ts`, `app/layout.tsx`
  (`primitives.css` import, `<UiSoundClicks />`), `app/styles/tokens.css` (Liquid fill and shadow, gloss tints, new
  durations zeroed under reduced motion, Lite blur).
- **Behaviour change on real pages:** `CountUp` no longer counts when the learner's Motion is Reduced or Off (it already
  stopped for the OS setting). `<html>` gains `data-effects` and `data-lite`.

## Skipped or noted

- `.ds-draw` animates `stroke-dashoffset` (paint only, no layout), the one exception to "transform, opacity or gradient
  position"; there is no other way to draw a path in.
- The reward sound is calmer than the prototype's: chimes over a low swell, without the noise whoosh and crackle.
- The D3 page entrance (`ui-page-in` on `<main>`) predates the Motion setting and still only follows the OS setting;
  it belongs to the page restyle stages.
- Iris primary buttons put white text on a translucent iridescent gradient (as in the prototype). Contrast depends on
  what is behind them, so check it on real pages when they are restyled.
- No Account UI for Effects or UI sounds yet; they're on `/dev/design` only.
