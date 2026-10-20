# D0 · Design audit (report only)

Stage D0 of the design rebuild. Nothing in the app was changed. Inputs read: `AGENTS.md`/`CLAUDE.md`, `README.md`,
`package.json`, `app/layout.tsx`, `app/fonts.ts`, every CSS file under `app/`, `app/env/prefs.ts`, `app/ui/glass-lens.tsx`,
`public/art`, `docs/design/ASSETS.md`, the progress/leaderboard code and migrations, and in `design-reference/`:
`README.md`, `DESIGN.md`, `src/app13.jsx`, `css/prototype-all-layers.css` (plus the imports of every `src/` file).

**Build Plan docs:** none found in the repo (no file mentions a "Build Plan"). This audit uses `README.md`,
`docs/design/ASSETS.md` and the code itself instead.

**Setup note:** the design zip had been uploaded loose into the repo root (it also replaced the root `README.md`). On this
branch it was moved into `design-reference/` with the zip's own structure (byte-identical to the zip in commit `8aa62fa`),
and the original README was restored. That commit is the only change besides this file.

---

## 1. How the app is styled today

Plain global CSS plus a small set of React UI primitives. **No Tailwind, no CSS Modules (0 `*.module.css`), no PostCSS
config, no component library.** All CSS is imported as global stylesheets; class names use a `ui-` prefix.

| File | Lines | Role |
|---|---|---|
| `app/styles/tokens.css` | 218 | D1 design tokens: `--color-*`, `--tint-*`, `--glass-*`, `--font-*`, `--text-*`, `--space-*`, radii, motion, layers. Dark only. Contrast checked by `tests/unit/design-tokens.test.ts`. |
| `app/styles/components.css` | 1002 | Shared `ui-*` components (page head, blocks, badges, menus, modals, reveal, spotlight). |
| `app/globals.css` | 428 | Base element styles, layout. |
| `app/styles/polish.css` | 291 | Later refinements. |
| `app/styles/glass.css` | 97 | D5 glass: Liquid (SVG lens) vs Frosted, via `html[data-glass]`. |
| `app/ui/neo.css` | 60 | Course UI that is deliberately *not* glass. |
| `app/env/env.css` | 39 | Wallpaper scene layer. |
| `app/learn/c2.css`, `app/learn/choose/choose.css` | 37, — | Learner pages. |
| `app/admin/import/import.css`, `app/admin/topics/topics.css` | — | Admin pages. |
| `app/landing/hall/hall.css`, `app/landing/world/world.css` | — | Landing hero (Hall photo, world hero). |

Import order in `app/layout.tsx`: `tokens.css` → `components.css` → `globals.css` → `polish.css` → `glass.css`.

**UI primitives** (`app/ui/`): `glass.tsx`, `glass-lens.tsx` (liquid lens, already a port of the prototype idea),
`count-up.tsx` (own CountUp, no dependency), `icons.tsx`, `menu.tsx`, `modal.tsx`, `tabs.tsx`, `meter.tsx`, `toasts.tsx`,
`reveal.tsx`, `spotlight.tsx`, `picture.tsx`, `neo.tsx`, `status-label.tsx`, `sound/*`.

**Fonts** (`app/fonts.ts`): `next/font/google`, self-hosted at build: Geist, Geist Mono, Instrument Serif (headlines),
plus Sora and Bricolage (style-guide candidates only).

**Appearance attributes already on `<html>`**, set before first paint by `prefsBootScript()` (`app/env/prefs.ts`), stored
in `localStorage` (`ascentra.scene`, `ascentra.glass`, `ascentra.motion`):
- `data-scene`: `reef | lake | mist | sun | hall` (WebGL wallpaper via `app/env/env-root.tsx`, lazy `import("./env-gl")`)
- `data-glass`: `liquid | frost` (default `liquid`)
- `data-motion`: `full | simple | off`, plus `data-motion-auto` when the device is slow/low-power.

## 2. Routes and layouts

One layout: `app/layout.tsx` (ClerkProvider, boot script, `EnvRoot`, `GlassLens`, `Spotlight`, `SoundProvider`,
`BillingBanner`, `StaffNav`, `DeviceGate`). Also `app/error.tsx`, `app/not-found.tsx`. No nested layouts or templates.

| Route | Main component | Prototype page |
|---|---|---|
| `/` | `Home` (`app/page.tsx`): `WorldHero`/`Hall` for visitors, account line for signed-in | **Home** (signed-in part); landing = no prototype page |
| `/learn` | `LearnList` | **Library** (course list) / partly **Home** (Round + section cards) |
| `/learn/path` | `PathPage` | **Home** (up next) — partial |
| `/learn/track/[slug]` | `TrackView` | **Home** (Round grid, section cards) |
| `/learn/track/[slug]/library` | `LibraryView` | **Library** |
| `/learn/[id]` | `LessonReader` | **Section** (Learn / Watch / Practice / Do it / Notes tabs) |
| `/learn/capstone/[courseId]` | `CapstoneView` | Section — partial |
| `/learn/progress` | `ProgressView` | **Profile** (widgets, course tree) |
| `/learn/leaderboard` | `LeaderboardView` | **Profile** (All-time rank widget) — partial |
| `/learn/notebook` | `NotebookView` | **Section** › Notes — partial |
| `/learn/choose` | `ChoosePage` | no prototype page |
| `/account` | account page (`Reveal`, `SignOut`, `ProtectTip`, `account-panel.tsx`) | **Account** |
| `/admin` | `AdminLinks`, `AdminsPanel`, `AdjustmentsPanel` | **Admin** (tiles) |
| `/admin/{audit,catalog,course-requests,courses,courses/[slug],import,missions,review,safety,security,sources,topics}` | `AuditLog`, `TopicCatalog`, `RequestQueue`, `CourseList`, `CourseBuilder`/`CourseStudio`/`ActivityLibrary`, `ImportPage`, `MissionsAdmin`, `ReviewChecklist`/`BoostersPanel`, `SafetyQueue`, `SecurityConsole`, `SourceLibrary`, `TopicsAdmin` | **Admin** (each is one tile's destination; `/admin/review` is *Owner review*, not the learner Review deck) |
| `/admin/style-guide` | `StyleGuide` | no prototype page (internal) |
| `/dev/course-ui` | `CourseUiShowcase` | no prototype page (internal) |
| `/community` | `CommunityView` | no prototype page |
| `/guardian` | `GuardianCenter` | no prototype page |
| `/pro` | `ProGate` | no prototype page |
| `/sign-in`, `/sign-up`, `/welcome` | `SignInFlow`, `SignUp`, `WelcomeFlow` | no prototype page |
| `/credits`, `/not-available`, `/not-open` | inline | no prototype page |

**Review (learner flashcard deck):** no route today. The prototype's Review page has no counterpart.

## 3. Real data vs Demo

Source of truth: `public.item_completions` (one row per finished item, with points and the learner's local day;
migration `0021`), read by `lib/progress/learner.ts` (`myProgress`) and `lib/leaderboard.ts`; served by
`/api/v1/learn/progress` and `/api/v1/leaderboard`.

| Prototype feature | Real today? | What exists / what is missing |
|---|---|---|
| **Points** | **Yes** | Total points, per course, and `pointsByDay` (last 30 days). "+4 today" is derivable. |
| **Streak** | **Yes** | `current` and `longest` (DB `private.learner_streaks`; rules in `lib/progress/config.ts`, STARTER). The 7-day dots are derivable from completion days. |
| **Rank** | **Partly** | Real rank = a *named tier* (Initiate … Ascendant, STARTER thresholds) and the leaderboard (adults: nickname, rank, streak; teens: simulated rivals already labeled "Practice rival (simulated)"). The prototype's "#12 of 1,240", "Up 3 this week" and "2 places to Top 10" are **not** computed anywhere → Demo. |
| **Course progress** | **Yes** | Per course: percent, done/items, module states (done / open / locked + reason, rank gates), Rounds for skill tracks, capstone. Enough for the Course map tree and section chips. |
| **Activity grid** | **Partly** | Real: which days had completions and points per day (30 days returned; the table has all of them). Not real: **minutes studied** (never recorded), the Rest/Missed distinction, Year view (API caps at 30 days). Levels must be based on points/items, or the widget stays Demo. |
| **Recent activity** | **Data exists, no API** | `item_completions.completed_at` could list "Finished X"; no endpoint returns a feed. Demo until one exists. |
| **Next reward** | **No** | No reward/milestone model. Demo. |
| **Trophies, coins, badges / Claim reward** | **No** | No table, rule or API. Demo (or "Simulated"). |
| **Progress globe** (Earth %) | Value yes, visual is decoration | The percent is real (course progress); the globe/cities are decoration. |
| **Review deck** (due cards, next 7 days, weak spots) | **No** | `review_items`/`schedules` tables exist (0003) but nothing reads or writes them. Flashcard *activities* exist inside lessons. Demo. |
| **Hall lights follow progress** | Value yes | Can be driven by real course percent; the prototype's slider is a demo control and must not ship as-is. |
| **Admin tile chips** ("2 drafts", "2 waiting") | Mostly yes | Counts are available from existing admin APIs; "People: Demo" and "Billing: Sandbox" need checking per tile. |

Rule carried forward: anything in the "No" or the not-real part of "Partly" keeps a visible **Demo** or **Simulated** label
(the tokens `--color-demo`, `--color-simulated`, `--tint-demo` already exist).

## 4. Dependencies

| Package | In the repo? | Used by the prototype for | Recommendation |
|---|---|---|---|
| `three` `^0.186.1` (+ `@types/three`) | **Yes** | `Earth.jsx`, `Art3D.jsx` (coins/trophies/badges) | Keep. Already lazy-loaded today (`import("./hero-3d")`, `import("./env-gl")`). |
| `lenis` | **No (new)** | Smooth scroll in `app13.jsx` | Optional. Scroll-jacking risk for accessibility and `position: sticky`; skip unless the Owner wants it. If added: dynamic import in a client effect, only when `data-reduced="0"` and pointer is fine. ~4 KB gz. |
| `motion` | **No (new)** | Only `CountUp.jsx` (`motion/react` springs) | Not needed: `app/ui/count-up.tsx` already does this with no dependency. Skip. |
| `cobe` | **No (new)** | Not used by the prototype | A small (~5 KB) MIT WebGL globe needing **no texture images**. A good replacement for `Earth.jsx` if the Earth textures can't be licensed. |

**Lazy-load plan (heavy pieces):**
1. Every WebGL piece (Earth/cobe globe, Art3D, Aurora shader, SpecularButton shader) lives in its own `"use client"`
   module loaded with `next/dynamic(..., { ssr: false })` or `import()` inside `useEffect`. Never imported from a layout.
2. Mount only when visible (`IntersectionObserver`) and after idle (`requestIdleCallback`, as `env-root.tsx` already does).
3. Gate on capability: skip entirely when `data-reduced="1"`, `data-motion="off"`, `data-motion-auto` is set, on
   coarse pointers / narrow screens, `navigator.connection.saveData`, or `hardwareConcurrency <= 3` (the prototype's
   "lite" rule). Show a static CSS/poster fallback (the prototype already has `CoinCSS`, `TrophyCSS`, `BadgeCSS`).
4. One shared WebGL canvas for all Art3D items (the prototype already does this), never one context per widget.
5. Keep `three` out of the first-load bundle; check with `npm run check:bundle` and the build's route sizes.

## 5. Proposed token architecture

**Where:** extend what exists instead of adding a second system.
- `app/styles/tokens.css`: base tokens on `:root` (Iris = today's palette, already `#080813` / `#A0BDDB`), then
  `:root[data-theme="mono"] { … }` overrides for the Mono palette only.
- `app/styles/glass.css`: glass recipes keyed on `:root[data-glass]` (already the case).
- `app/styles/motion.css` (new, D1): `:root[data-reduced="1"]` turns off animation; durations as tokens.
- Component CSS reads tokens only; no hex values outside `tokens.css` (the 15 prototype layers are consolidated, not copied).

**Names (additions, keeping the existing `--color-*` scheme):**
- Theme surfaces: `--color-base`, `--color-surface`, `--color-raised`, `--color-text`, `--color-text-muted`, `--color-accent` (exist) + `--color-ok`, `--color-gold`, `--color-gold-soft`.
- Accent set: `--accent-1` … `--accent-5` (section-card cycle), `--accent-violet`, `--accent-cyan`, `--accent-purple`, `--accent-mint`.
- Widget accents: `--widget-streak`, `--widget-points`, `--widget-rank`, `--widget-next` (cool in Iris, warm in Mono).
- Activity levels: `--activity-rest`, `--activity-miss`, `--activity-short`, `--activity-steady`, `--activity-focus`, `--activity-grind`.
- Buttons: `--button-fill` (Iris iridescent gradient / Mono champagne), `--button-ink`, `--seg-selected`.
- Glass (exist, extend): `--glass-fill`, `--glass-blur`, `--glass-filter`, `--glass-rim`, `--glass-inset`, `--glass-drop`, `--glass-sheen`, `--glass-radius`.
- Light source (Mono): `--light-x: 68%`, `--light-y: 13vh`, `--light-core`, `--light-falloff`.
- Motion: `--ease-out: cubic-bezier(.16,1,.3,1)`, `--dur-press: 120ms`, `--dur-hover: 200ms`, `--dur-enter: 800ms`.
- Type: `--font-display` (→ "Ascentra Display", see Q2), `--tracking-caps: .07em`.

**Attributes, set before paint (no flash):** extend `prefsBootScript()` in `app/env/prefs.ts`, which already runs as
the first thing in `<body>` (raw `<script>` markup, so it executes during HTML parsing before anything paints) and sets
`data-scene`, `data-glass`, `data-motion`. Add:
- `data-theme`: `iris | mono` from `localStorage["ascentra.theme"]`, default `iris`.
- `data-glass`: keep the stored values `liquid | frost` (the prototype's `frosted` = `frost`; no migration needed).
- `data-reduced`: `"1"` when `data-motion` is not `full` **or** `matchMedia("(prefers-reduced-motion: reduce)")` matches, else `"0"`.
  `EnvRoot` also sets it when it detects a slow device (it already sets `data-motion-auto`).
- `data-refract`: `"1"` only when Liquid is chosen and SVG `backdrop-filter` is supported (feature-detect, as `glass-lens.tsx` does; avoid UA sniffing).
- `suppressHydrationWarning` is already on `<html>`, so React tolerates these attributes.
- Later (account-level saving): the server can render the same attributes from the profile; the script then only fills gaps.

Motion level mapping: prototype `full | reduced | off` = app `full | simple | off`. Keep the app's stored values and
labels unless the Owner wants the wording changed (Q4).

## 6. Risks and unknowns

**Licensing (verify before shipping any of these):**
- `Aurora.jsx`, `SpecularButton.jsx`, `CountUp.jsx`: described as react-bits-derived; the files carry **no licence header
  or attribution**. React Bits' licence terms (and whether SpecularButton is from React Bits at all) must be confirmed by
  the Owner from the source; I could not check it here (no live access). Until confirmed, treat them as reference only
  and write our own shaders/components. CountUp is moot: the app has its own.
- **Earth textures**: `Earth.jsx` imports `../tex/day.jpg`, `night.jpg`, `water.jpg`, `clouds.jpg`, which are **not in the
  zip** ("source/licence unverified" per the README). Source and licence unknown. Options: find a verified public-domain
  source, or use `cobe` (no textures).
- **Hall images**: `Hall.jsx` imports `../tex/hall.webp`, `hall-mask.png`, `hall-foliage.webp`; the repo already has
  `public/art/hall-*`, `hall-sky-mask.png`, `hall-foliage.*` (Higgsfield AI, logged in `docs/design/ASSETS.md`; counsel
  review of Higgsfield commercial terms is still open).
- **Ascentra Display font**: original (made by `font/mk.py`), so fine, but it must be added to `/credits` and
  `ASSETS.md`. The prototype CSS also names `Inter` and `JetBrains Mono` while `DESIGN.md` says system UI only and the app uses Geist (Q2).
- `three` and `cobe` are MIT; `lenis` is MIT; `motion` is MIT.

**Does `design-reference/` break the toolchain?** (run once on this branch after the move)
- `npm run typecheck`: **passes.** `tsconfig.json` includes only `*.ts`, `*.tsx` and `*.mts`, so the `.jsx` and `.js` files are not checked.
- `npm run build`: **passes.** Nothing imports the folder, and it isn't under `public/`, so it isn't served.
- `npm run lint` (`eslint .`): **fails, 13 errors and 10 warnings, all inside `design-reference/src/`**. The files are
  `app13.jsx`, `Art3D.jsx`, `Aurora.jsx`, `Earth.jsx`, `Hall.jsx`, `SpecularButton.jsx` and `audio.js`. The errors are
  refs read during render, unescaped quotes, and a non-inline `useCallback` argument. `main` had the same files at the
  repo root, so lint on `main` very likely fails too since `2772e23`.
- **Fix (one line, not applied in D0):** add `"design-reference/**"` to `globalIgnores([...])` in `eslint.config.mjs`
  (next to the existing `"reference/**"`). Optionally also add `"design-reference"` to `tsconfig.json` `exclude` and a
  `.vercelignore` entry so the 2.2 MB prototype isn't uploaded on deploys. Vitest only includes `tests/**`, and
  Playwright uses its own configs, so neither is affected.

**Product and technical risks:**
- **Two appearance systems collide.** The app has 5 WebGL/photo *scenes* (D5); the prototype has 2 *themes* (Iris/Mono)
  plus Aurora and the Hall on the home hero. Rebuilding blindly would double the background layers and GPU cost (Q1).
- Glass budget: the prototype puts `backdrop-filter` on every `.g` panel (34 uses) plus the SVG lens on each. That is
  costly on large pages (admin tables, lesson reader). `glass.css` already excludes `main.ui-admin` and course UI; keep that.
- Pointer effects on `window` (spotlight, tilt, trailing glow, click sparks, sound on every click) are global listeners.
  They need passive listeners, rAF throttling and `data-reduced` gates (the prototype does this; keep it).
- "No tilt on hover for HUD panels" (DESIGN.md) conflicts with the prototype JS, which tilts `.tile`, `.seccard`, `.stat`
  and `.widget`. Clarify (Q6).
- The Liquid lens is detected by Chromium UA sniffing in the prototype (`userAgentData`). The app's feature detection is better; keep it.
- Sound: the app already has an ambient player (`SoundProvider`). Prototype click sounds are a second sound system. Both need one shared on/off setting.
- The prototype's Learner/Owner role switch in the HUD must not ship. Real roles come from `lib/caps.ts`.
- Accessibility: Course map nodes are SVG `<g role="button">`, and activity cells are `div`s with `tabIndex`. The rebuild
  should use real `<button>`s, or the same roles with focus styling, and must keep the 4.5:1 contrast tests passing.
- Clerk-hosted UI (`clerk-appearance.ts`) has to follow the theme tokens, or sign-in will look off in Mono.

## 7. Questions for the Owner

1. **Scenes vs themes:** should Iris/Mono replace the five D5 scenes (Reef, Lake, Mist, Sunrise, Hall), sit on top of them as a colour theme, or should only the Hall remain?
2. **Fonts:** should Ascentra Display replace Instrument Serif for headings, and should body text move from Geist to the system UI stack (DESIGN.md says no third-party fonts)?
3. **Default glass:** the prototype's default is Frosted, but the app's is Liquid. Which should new visitors get?
4. **Motion labels:** should the middle motion level be called "Reduced" (prototype) or "Simple" (app today)?
5. **Licences:** can you confirm the source and licence of Aurora, SpecularButton and CountUp, and of the Earth textures? If not, may we use `cobe` (no textures) for the globe?
6. **Hover tilt:** should tiles, section cards, stats and widgets tilt on hover as in the prototype, or follow DESIGN.md's "no lift or tilt"?
7. **Demo widgets:** should trophies, coins, badges, Next reward, positional rank ("#12 of 1,240") and the Review deck ship labeled Demo, or stay hidden until real data exists?
8. **Activity grid:** minutes aren't recorded. Should the grid use points or items per day, or should we start recording study time?
