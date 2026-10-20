# D5 · The Profile dashboard (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only, plus the one allowed read-only change (step 4). Built only on the
D1–D4 primitives: tokens, Ascentra font, `Icon`, `Glass` (widget mode, never tilts), button classes, `Segmented`,
motion, `CountUp` (the app's own), the preferences module. No prototype Aurora, SpecularButton or CountUp code.

**Where:** the Profile is the existing **My progress** page (`/learn/progress`, the HUD's Progress tab; D0 mapped the
prototype's Profile here).
- **New:** a "Your dashboard" section at the top. It uses the page's existing single read
  (`GET /api/v1/learn/progress`); nothing new is fetched.
- **Unchanged below:** every existing section (Rank and streak, Your courses with locked and gated reasons, trial
  bonus and capstone links, Skills, Over time, Quiz scores). Their surfaces now follow the theme tokens (`ds-page`).

## The one allowed exception: 365 days of points (step 4)

- **Before:** `myProgress()` already read **all** of the learner's `item_completions` (the same query the streak
  uses) and kept only the last 30 days that had points, using `.slice(-30)` in TypeScript.
- **Now:** a pure helper `pointsWindow()` in `lib/progress/rules.ts` keeps the **last 365 calendar days ending today**
  in the learner's time zone, oldest first.
- **What didn't change:** no SQL, no schema change, no new query, no new permission. The route stays
  `withCap("learn")` with the same access rules (unit tests check the route, the query and the helper).
- **My progress's own list:** "Over time" still shows the last 30 days with points. The page slices on the client, so
  nothing there changed for learners.

## Widgets (real data only, decision 7)

| Widget | Data | Hidden when |
|---|---|---|
| **Progress globe** | Items done of items across active courses (paused courses left out); the percent and "9 of 28 items done across your courses" are written beside it. | No items to count. |
| **Streak** | Current and best streak; seven squares for the last 7 days (a square is lit when items were finished that day), today outlined. | Never (a streak of 0 is real). |
| **Points** | Total points; "+N today" only when there are points today; a draw-in sparkline of points per day for the last 30 days. | The sparkline, when there is no history ("Finish an item to start your points history."). |
| **Activity** | Points per day (decision 8; minutes are never recorded, so never shown). Week, Month and Year (365 days). See below. | No points history. |
| **Rank** | The named tier, "Next: Builder, 11 more points", a ladder of the ten named tiers with the learner's own marked, and a link to the existing leaderboard page. **Never a position** like "#12 of 1,240" (tested). | Never. |
| **Course map** | A branching tree: one branch per active course off a "You" node; nodes are the real sections, done, now, up next or locked (with the lock reason). Open nodes link to the course's existing page; locked nodes are labelled images. A primary **Continue** goes to the current course. | No active course with sections. |

- **Progress globe:** `cobe` 2.0.1 (MIT, no textures), loaded with `next/dynamic(..., { ssr: false })`, so it's its
  own 14 KB chunk (the dashboard chunk doesn't contain it).
  - A drawn CSS sphere (the poster) shows first and stays in **Lite** mode (phones, slow devices).
  - It turns slowly only while motion is on; it pauses off screen or in a hidden tab, and is destroyed on unmount.
  - Decorative (`aria-hidden`).
- **Activity grid:**
  - **Views:** Week shows big cells with the day and points; Month is a calendar; Year shows 365 small cells.
  - **Labels:** every cell has an `aria-label` ("Mon, Oct 19 · 4 points · Steady"). A hover/focus text line (live
    region) repeats it, and a total reads "17 points over 4 days".
  - **Legend:** the levels in words. Colours are DESIGN.md's: rest, missed, short, steady, focused, grind.
  - **Levels by points:** 1–2 short, 3–5 steady, 6–9 focused, 10+ grind. "Missed" is only the day the streak reset
    (a day with no points right after a day with points, never today).
- **Not built** (decision 7): trophies, coins, badges, Next reward, Recent activity, Review deck. There are no demo
  versions and no demo data files. The only new data is a deterministic **test fixture** for the component tests and
  screenshots (`e2e/components/fixtures/d4-data.ts`, marked TEST DATA).

**Widget chooser:** a "Choose widgets" menu (a glass popover, closes with Escape or a click outside) with a checkbox
per widget. Widgets with no data are disabled, "· no data yet". Each widget has an X ("Hide Streak", …) shown on hover
or keyboard focus, and always shown on touch screens. The choice is saved with the other client preferences
(`app/env/prefs.ts`, `ascentra.profileWidgets`, this browser only, never throws) and survives a reload (tested).

**Look and behaviour:**
- **Accents:** cool in Iris and warm in Mono (`--widget-*`; the course-map branches also turn warm in Mono).
- **Tilt:** no tilt anywhere in the dashboard (decision 6, tested).
- **Phone:** one column; the tree scrolls sideways inside its own focusable box, with no page overflow (tested).
- **Motion:** Reduced and Off stop every `ds-`, `pf-`, `bd-` and `hud-` animation (tested) and the globe holds still.
- **Truthful labels:** only real words. There's no Connected, Verified, Live or Approved anywhere, and no income
  claims. Teens: unchanged (simulated practice only); the dashboard shows only the learner's own data.

## Iris primary button contrast (course map "Continue")

[`shots/d5-primary-button-contrast.json`](shots/d5-primary-button-contrast.json), measured behind the text with the
highlight forced on:

| Theme / glass / width | Worst | Median |
|---|---|---|
| Iris / Frosted / 1280 | **4.9:1** | 5.8:1 |
| Iris / Liquid / 1280 | **5.0:1** | 5.71:1 |
| Iris / Frosted / 390 | **5.0:1** | 5.84:1 |
| Mono / Frosted / 1280 (dark ink) | **9.91:1** | 12.21:1 |

## Screenshots (`docs/design/shots/`)

Rendered in Chromium from the real components and stylesheets, with the test fixture (the app server can't start
here without secrets; the date is fixed to 2026-10-19).

- **Before:** `d5-before-profile-{iris|mono}-frost-{1280|390}.jpg`
- **After:** `d5-after-profile-{iris|mono}-{frost|liquid}-{1280|390}.jpg`. The 1280px shots are full page; phone
  Liquid shows the Lite poster.
- **Regenerate:** `DESIGN_SHOTS=1 DESIGN_SHOTS_TAG=after npx playwright test -c playwright.components.config.ts d5-shots`

## Tests and checks

- **Unit** `tests/unit/d5-profile.test.ts` (11 tests):
  - the 365-day window (inclusive edges, nothing older, nothing in the future, longer than the old 30);
  - the source checks (no SQL change, same query, same `withCap("learn")`, the view still shows 30);
  - overall progress, the 7 days, the sparkline (null without history);
  - activity levels and their agreement with the server's streak rule; 365 Year cells labelled in points and never
    minutes;
  - the rank ladder (ten named tiers, the learner's marked);
  - course-map states, with paused courses excluded;
  - the widget choice (save, read, junk ignored, never throws).
- **Chromium** `e2e/components/design-profile.spec.ts` (9 tests; 81/81 over repeated runs):
  - six widgets from real data, and none of the hidden-only widgets;
  - no positions, minutes, Demo or Simulated text;
  - **hidden widgets when data is missing** (the globe, Activity and Course map disappear, and the chooser marks them
    "no data yet");
  - Week, Month and Year (365 cells) with labels, the hover line and the legend;
  - the chooser and X with a saved choice that survives a reload;
  - course-map states and links;
  - 390px: one column, the tree scrolls in its box, the Lite poster;
  - the cobe globe on desktop;
  - Motion Reduced and Off.
- **Existing accessibility tests:** the axe scans of My progress at 1280px and 390px (in `progress-paths.spec.ts`) now
  scan the dashboard too, and pass.
- **Results:**
  - lint ✔
  - typecheck ✔
  - unit tests 61 files, 4257 passing ✔
  - build ✔
  - component tests 149 passing (47 screenshot-only tests skipped) ✔
  - check:bundle ✔
  - check:build-secrets not run (needs real secrets)

## Failures and fixes (one attempt each)

- **`progress-paths.spec.ts`, My progress:** two failures.
  - The course-map nodes also carried an SVG `<title>` that repeated their label, so a lock reason appeared twice.
    **Fixed in the product:** removed the redundant `<title>` (the aria-label already says it).
  - Its 390px check rendered the page without the new stylesheets. Fixed in that spec's stylesheet list, which now
    matches what the app loads.
- **Test-side only:** in `design-profile.spec.ts`, a wrong count in my own fixture expectation (4 active days in the
  last 7, not 3), and a one-column check that measured during the entrance animation.

## Files

- **New:**
  - `app/learn/progress/profile/{profile-dashboard,activity-grid,course-map,globe-canvas}.tsx`
  - `app/learn/progress/profile/{profile-data.ts,profile.css}`
  - `tests/unit/d5-profile.test.ts`
  - `e2e/components/{design-profile,d5-shots}.spec.ts`
  - `docs/design/shots/d5-*`
- **Changed:**
  - `lib/progress/rules.ts`: `pointsWindow`, `POINTS_WINDOW_DAYS`
  - `lib/progress/learner.ts`: uses `pointsWindow`
  - `app/learn/progress/progress-view.tsx`: renders the dashboard; the list keeps 30 days
  - `app/learn/progress/page.tsx`: `ds-page`, wider
  - `app/env/prefs.ts`: the widget choice
  - `package.json` and lock: `cobe@^2.0.1`
  - `e2e/components/fixtures/{d4-data.ts,shell-entry.tsx,shell-harness.ts}`
  - `e2e/components/progress-paths.spec.ts`: its stylesheet list

## Noted for later

- The globe takes its colours from the theme when it mounts; switching theme while on the page keeps the old colours
  until the next visit.
- The integration test suite (real Postgres) wasn't run here; the 365-day change doesn't touch SQL, and the unit tests
  cover the window.
