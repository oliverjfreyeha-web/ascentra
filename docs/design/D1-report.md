# D1 · Foundations report (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only, additive. Owner decisions recorded word for word in
[`decisions.md`](decisions.md). D2 not started.

## What changed

| # | Item | Done |
|---|---|---|
| 1 | CI ignores `design-reference/` | `eslint.config.mjs` `globalIgnores` + `"design-reference/**"`; `tsconfig.json` `exclude` + `"design-reference"`. Build never imported it. **Lint is green again.** |
| 2 | Tokens, both themes | Extended `app/styles/tokens.css` (nothing replaced; every D1–D5 token keeps its value). New Iris block (`:root, [data-theme="iris"]`) and Mono block (`[data-theme="mono"]`): ink/frost/ok/gold, `--accent-1…5`, `--widget-*`, `--activity-*`, page wall and Mono light source, `--button-fill`, `--seg-selected`, glass fill/rim/shadow, `--radius-glass*`, `--blur-hud/panel/liquid/fallback`, `--ease-glide: cubic-bezier(0.16, 1, 0.3, 1)`, `--duration-press/hover/enter/icon`, `--scale-press`, `--tilt-max` (8deg), `--z-scene/hud/popover/reward`, icon gradient colors. Mono also overrides the D1 palette, all at ≥ 4.5:1 text and ≥ 3:1 borders. |
| 3 | Preferences | Extended the existing `app/env/prefs.ts` and its pre-paint script (no second system). Adds `theme: iris \| mono` (`ascentra.theme`), `data-theme` and `data-reduced` set before first paint. `data-reduced="1"` when motion ≠ Full, the device asks for reduced motion (always respected), or a slow device turned motion down. Default glass is now **Frosted**. Stored values unchanged (`simple` is labelled "Reduced" via `MOTION_LABEL`); saved D5 choices read as before. `env-root.tsx` keeps `data-reduced` in step with OS changes and the slow-device check. Sound was already off by default. |
| 4 | Font | `public/fonts/AscentraSemi.woff2` (byte copy). `@font-face` "Ascentra Display" in `app/styles/design.css` with `font-display: swap` and a `unicode-range` matching its glyphs (A–Z, a–z mapped to caps, 0–9, some punctuation); `·`, quotes etc. fall back. Preloaded with React 19 `preload()` in `app/layout.tsx`. `--font-ascentra: "Ascentra Display", var(--font-sans)`. Opt-in classes `.ds-display`, `.ds-num`, `.ds-caps`. Body stays Geist; no Google Fonts. |
| 5 | Icons | `app/ui/design/ds-icon.tsx`: typed `<Icon name size title? />`, all 31 prototype icons, layered (tint fill, main line, accent line, highlight). Gradients defined once by `<IconDefs />` in the root layout, colored by theme tokens. No hooks or browser APIs (server and client safe). Draw-in and hover/focus animations in `design.css`, only under `:root:not([data-reduced="1"])` and off with `prefers-reduced-motion`. |
| 6 | Base | Already present: `lang="en"`, 2px `:focus-visible` ring, selection and scrollbar colors, body text ≥ 4.5:1 (tested). Selection and scrollbar now read `--selection-*` / `--scrollbar-thumb`, so they follow the theme (same values in Iris). |
| 7 | Preview | `/dev/design` (`app/dev/design/`): tokens with live computed values, type scale, glass/button/segmented/tilt samples, all icons, both themes side by side, plus whole-page Theme / Glass / Motion controls. 404 on production (same rule as `/dev/course-ui`), `noindex`, linked from nowhere (tested). |

## Files

Changed: `eslint.config.mjs`, `tsconfig.json`, `app/env/prefs.ts`, `app/env/env-root.tsx`, `app/layout.tsx`,
`app/styles/tokens.css`, `app/styles/glass.css` (selection/scrollbar tokens, comment), `tests/unit/env-prefs.test.ts`
(defaults now Frosted + theme + data-reduced, per Owner decision 3).
Added: `docs/design/decisions.md`, `docs/design/D1-report.md`, `app/styles/design.css`, `app/ui/design/ds-icon.tsx`,
`app/dev/design/{page.tsx,preview.tsx,preview.css}`, `public/fonts/AscentraSemi.woff2`, `tests/unit/design-themes.test.ts`.

## Checks (run on this branch)

- `npm run lint`: pass. `npm run typecheck`: pass. `npm run build`: pass (`/dev/design` prerenders as 404 in production).
- `npm test`: 57 files, 4221 tests pass (new `design-themes.test.ts`: Mono contrast, Iris/Mono parity, easing and
  reduced-motion tokens, font self-hosted + swap + preload, icons server-safe and motion-gated, preview closed on
  production and unlinked).
- `npm run check:bundle`: pass. `npm run check:build-secrets`: not run, it needs the real secrets in the environment.
- Visual: the app can't start here (no `.env.local`), so the preview was rendered to static HTML and screenshotted in
  Chromium with the real CSS. Font loads, icons paint with gradients, both themes render; an Iris region inside a
  Mono page resets correctly (found and fixed during the check).

## How to preview

`npm run dev`, open `http://localhost:3000/dev/design` (also works on Vercel preview deployments, never production).
Use the Theme / Glass / Motion controls at the top to switch the whole page; they save to this browser exactly like the
real preferences. Turn on the OS "reduce motion" setting to see `data-reduced` flip to 1.

## Behavior changes to real pages (intended, and only these)

- New visitors (nothing saved) get **Frosted** glass instead of Liquid (Owner decision 3). Visitors who saved a glass
  keep it.
- `<html>` gains `data-theme="iris"` and `data-reduced`. Nothing in product CSS reads them yet except the new tokens.
- One hidden, zero-size `<svg>` of icon gradients and a font preload on every page (4.4 KB font).

## Skipped or deferred

- The Ascentra font is **not yet applied** to existing headings; the classes exist for D2+ (applying them now would
  restyle every screen).
- No UI to choose the theme outside `/dev/design`; Account settings come in a later stage. `data-scene` and the
  scene WebGL code are untouched (D3, per decision 1).
- The prototype's always-on icon loops (flame flicker, star twinkle, clock tick) were not ported; DESIGN.md asks for
  hover animations, and constant motion conflicts with the calm brief. Easy to add if wanted.
- Derived D1–D5 tokens that are computed on `:root` (for example `--focus-ring`, `--gradient-page`) follow the theme
  only when it is set on `<html>`, not inside a scoped `[data-theme]` region. Fine for the product; noted for the preview.
- `README.md` was not updated (the restored original describes Foundations, not design).
