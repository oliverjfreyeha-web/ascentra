# Testing the design rebuild

How to run each test group, how to update the visual baselines on purpose, and what is deliberately not covered.

- **Offline:** every group below runs offline. No secrets and no network.
- **Browsers:** they use Chromium through Playwright. In the cloud container, Chromium is already installed; don't run
  `playwright install` there.

## The groups

| Group | Command | In CI? | What it covers |
|---|---|---|---|
| Lint | `npm run lint` | Yes | ESLint over the repo (ignores `design-reference/**`) |
| Typecheck | `npm run typecheck` | Yes | `next typegen` + `tsc` (`design-reference` is excluded in `tsconfig.json`) |
| Unit tests | `npm test` | Yes | Vitest, `tests/unit/**` (and `tests/gate1/**`); see the design files below |
| Component tests | `npx playwright test -c playwright.components.config.ts` | Yes (Component tests job) | Real pages and stylesheets in Chromium with no server; the API is answered by test fixtures |
| Visual baselines | `npm run test:visual` | **No**, on demand | 30 screenshots compared with the baselines in `e2e/visual/baselines/` |
| Design screenshots and contrast | `DESIGN_SHOTS=1 DESIGN_SHOTS_TAG=after npx playwright test -c playwright.components.config.ts <spec>` | No (skipped without `DESIGN_SHOTS`) | Writes the report screenshots and contrast JSON under `docs/design/shots/` |
| Build | `npm run build` | Yes | Production build (needs the build environment's variables) |
| Bundle check | `npm run check:bundle` | Yes | No secrets in the client bundle |

### Unit tests for the design (`tests/unit/`)

| File | Covers |
|---|---|
| `env-prefs.test.ts` | Preferences: defaults, valid, invalid and old saved values (a saved scene, "simple" motion), storage that throws, Lite, the pre-paint boot script |
| `d8-gaps.test.ts` | The runtime attribute setter (`applyPrefs`, `syncReduced`, `syncLite`); saving and reading back every preference; activity-grid Week, Month and Year ranges (month start, leap year, year boundary) and level boundaries; course-map links and summaries; `design-reference/` exclusions; visual tests kept out of CI |
| `lens-core.test.ts` | Liquid lens: attach, clear (Frosted, unmount), the 24-lens cap, who gets a lens, pointer maths |
| `d5-profile.test.ts` | The 365-day points read, activity levels, sparkline, rank ladder, course-map states, saved widget choice |
| `design-themes.test.ts`, `design-tokens.test.ts` | Theme tokens, Mono contrast, font, icons, motion tokens |
| `d4-pages.test.ts` | Home's Up next and the Library's counts and search |
| `d6-routes.test.ts` | Every route restyled or listed as skipped; calm pages; D6 rules scoped to `main.ds-page` |
| `d7-checks.test.ts` | No bounce or gradient text; motion properties; cheaper blurs; globe theme switch; removed dead classes |

### Component tests for the design (`e2e/components/`)

- **`design-primitives.spec.ts`:** glass, lens, buttons, motion and tilt on `/dev/design`.
- **`design-shell.spec.ts`:**
  - HUD and backdrop;
  - Appearance settings;
  - cursor glow and spark;
  - phones.
- **`design-pages.spec.ts`:** Home and the Library.
- **`design-profile.spec.ts`:**
  - the Profile dashboard;
  - widgets hidden when data is missing;
  - the 365-day grid;
  - the globe on a theme switch.
- **`design-routes.spec.ts`**, over 33 routes:
  - restyled and calm pages;
  - axe in both themes and both glass types, plus 390px on the baseline routes;
  - the design detector, with a positive control;
  - 390px and 768px with no sideways scroll;
  - Motion Reduced and Off;
  - Liquid detaching.

All of these build the real pages with `e2e/components/fixtures/shell-harness.ts`, and share the route list in
`fixtures/routes.ts` and the test data in `fixtures/d4-data.ts` and `fixtures/d6-data.ts`.

## Visual baselines

- **Run:** `npm run test:visual`.
- **What it captures:** Home, the Library (`/learn`), the Profile (`/learn/progress`), Account and Admin. Each at
  1280×900 and 390×844, in Iris + Frosted, Mono + Frosted and Iris + Liquid: 30 images in all.
- **Inputs:** test fixtures only, with no sign-in and the date fixed to 2026-10-19.
- **Stability:**
  - animations are disabled for the capture, after the entrance, reveals and counters finish;
  - fonts are loaded first, and the pointer is parked in a corner;
  - the WebGL globe is masked.
- **Tolerance:** 200 pixels per image, colour threshold 0.2. Two runs in a row match exactly.
- **When it fails:** Playwright writes the expected, actual and diff images under `test-results/`.

**Updating baselines on purpose** (only after a reviewed design change):

1. `npm run test:visual:update` rewrites the baselines (or a subset, with `-- -g "account-"`).
2. Look at every changed PNG in `e2e/visual/baselines/` in the diff before committing, and say in the commit message
   why it changed.

**Why they're kept out of CI:**

- **Setup:** they need `playwright.visual.config.ts`, which sets `VISUAL_BASELINES=1`. The spec skips itself
  otherwise.
- **Separate folder:** the component config only looks in `e2e/components`. A unit test checks that no workflow runs
  them.
- **Machine-dependent:** fonts and anti-aliasing differ between machines and Chromium builds. Baselines made on one
  machine can fail on another, so create and compare them on the same setup.

## Intentionally not covered

| Not covered | Why |
|---|---|
| Clerk's own forms (password sign-in fallback, the sign-up form, Account's Sign-in methods) | They need Clerk and real keys; tests stand them in as nothing. Their look is set by `app/clerk-appearance.ts` (literal Iris colours). |
| `/admin/style-guide` | An internal showcase of the old base components; not restyled (D6). |
| `/dev/course-ui` | An internal course-UI showcase, never on production; not restyled (D6). |
| The Review page | It has no route. |
| `npm run check:build-secrets` | It searches the build for the real secret values, so it needs them; CI generates throwaway ones. |
| `npm run test:db`, `npm run test:integration` | They need Postgres (and PostgREST); CI provides them. |
| `e2e/smoke` and `e2e/journeys` | They run against the live site with test accounts and secrets. |
| Live data and real sign-in in the visual and component tests | By design: fixtures only, so nothing reaches a live service. |
