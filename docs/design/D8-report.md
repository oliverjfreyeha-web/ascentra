# D8 · Tests (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Tests only.

- **App code:** no app code changed (no behaviour, permission, data, copy or label).
- **Testability:** the only additions are the visual config and two npm scripts.
- **Reuse:** everything reuses the existing harness (`e2e/components/fixtures/shell-harness.ts`), the shared route list
  (`fixtures/routes.ts`) and the test fixtures (`d4-data.ts`, `d6-data.ts`).
- **Offline:** no secrets, no network, no sign-in.

## What already existed (reused, not rewritten)

| Area asked for | Already covered by |
|---|---|
| Preferences: defaults, invalid values, storage that throws, old saved values (any scene, even the Hall or junk; "simple" motion shown as Reduced), boot script | `tests/unit/env-prefs.test.ts` |
| Lens attach and clear (Frosted and unmount remove everything; 24 cap; who gets a lens) | `tests/unit/lens-core.test.ts`; Liquid detaching on a real page in `design-routes.spec.ts` |
| Activity levels, the 365-day window (edges, nothing older or in the future), Year = 365 cells | `tests/unit/d5-profile.test.ts` |
| Course-tree states (done, now, next, locked; paused courses left out) | `tests/unit/d5-profile.test.ts` |
| axe | `design-routes.spec.ts`: every restyled route (33, including Home, Library, Profile, Account and Admin) at 1280px in Iris and Mono × Frosted and Liquid. Also `progress-paths.spec.ts` |
| Screenshots for reports | The `DESIGN_SHOTS=1` specs (`d4`/`d5`/`d6-shots`, `design-shots`, `d7-contrast`) |

## Gaps filled

1. **Unit tests** (`tests/unit/d8-gaps.test.ts`, 16 tests):
   - **Runtime attribute setter** (`applyPrefs`, `syncReduced`, `syncLite`): it had no unit test before.
     - every theme, glass and motion value lands on `<html>`;
     - Reduced (stored "simple") and Off turn on `data-reduced`, and so do the device setting and a slow device;
     - junk motion counts as Full, and `data-scene` is never written;
     - Lite on phones, few cores or Save-Data, unless "Always full";
     - listeners are told.
   - **Persistence:** every allowed combination saves and reads back exactly; invalid writes change nothing; "Reduced"
     is never stored.
   - **Activity grid ranges:**
     - Week is 7 days, Month starts on the 1st (one cell on the 1st), Year is 365 days;
     - month, year and leap-day boundaries (2028-02-29 is in its week; a 2028 year ends on 12-31 and starts 01-02);
     - points outside a range never leak in;
     - level boundaries at exactly 1, 3, 6 and 10 points.
   - **Course map:** a track links to `/learn/track/<slug>` and other courses to `/learn`; branches stay in order; the
     summary text for tracks and courses; no branch without sections; a finished course is all done.
   - **`design-reference/`:** ignored by ESLint, excluded by tsconfig, absent from the Vitest and Playwright configs,
     and imported by nothing in `app/` or `lib/` (so the build never includes it).
   - **Visual tests can't reach normal CI:**
     - their own folder and config;
     - no workflow mentions them;
     - the spec skips itself unless enabled;
     - the scripts are as documented;
     - every baseline file exists.
2. **Visual baselines** (`e2e/visual/design.visual.spec.ts`, `playwright.visual.config.ts`; `npm run test:visual`,
   `npm run test:visual:update`):
   - **Coverage:** Home, Library, Profile, Account and Admin at 1280×900 and 390×844, in Iris + Frosted,
     Mono + Frosted and Iris + Liquid. 30 PNGs in `e2e/visual/baselines/` (about 16 MB; the glass film grain doesn't
     compress well).
   - **Inputs:** fixtures only, with a fixed date (2026-10-19).
   - **Stability:**
     - animations are disabled for the capture, after the entrance, reveals and counters finish;
     - fonts are loaded first, and the pointer is parked;
     - the WebGL globe is masked.
   - **Tolerance:** 200 pixels, colour threshold 0.2.
   - **Stable:** two runs in a row matched exactly (0 pixels different with no tolerance).
   - **Sensitive:** a deliberate change (the muted ink on glass made red) failed both pages tried, by 3,987 and 619
     pixels. At first, 1% tolerance let that change through, so the tolerance was tightened to 200 pixels.
3. **axe smoke** (`design-routes.spec.ts`): the five baseline routes were already covered at 1280px in every look.
   Added: the same five routes at 390px in the three baseline looks. No serious or critical issues.
4. **`docs/design/TESTING.md`:**
   - every test group and its command;
   - which run in CI;
   - the design unit and component files and what each covers;
   - how to update baselines on purpose;
   - what is intentionally not covered: Clerk's own forms, `/admin/style-guide`, `/dev/course-ui`, the Review page
     (no route), `check:build-secrets` (needs real secrets), database and integration tests (Postgres), and the live
     smoke and journey suites.
5. **CI safety:**
   - **Visual tests:** CI's component job runs `playwright.components.config.ts` (`testDir: e2e/components`), which
     lists 0 tests from `e2e/visual`. The visual spec also skips without `VISUAL_BASELINES`, which only
     `playwright.visual.config.ts` sets.
   - **`design-reference/`:** stays excluded from lint, typecheck and build, and is now guarded by a unit test.

## Checks

- lint ✔
- typecheck ✔
- unit tests 64 files, 4287 passing ✔
- build ✔
- check:bundle ✔
- component tests 169 passing (76 screenshot-only tests skipped) ✔
- visual baselines 30/30, twice ✔
- check:build-secrets not run (needs real secrets)

## Failures and fixes (one attempt each)

- **Course-map unit test:** my first version assumed the wrong track shape (a separate track slug). The map uses the
  course's own slug, and a track carries Rounds. The test was corrected; the app is unchanged.
- **Visual tolerance:** 1% let a recoloured line of text through. It is now 200 pixels, which still passes run-to-run
  (identical images).

## Files

- **New:**
  - `tests/unit/d8-gaps.test.ts`
  - `e2e/visual/design.visual.spec.ts`
  - `e2e/visual/baselines/*.png` (30)
  - `playwright.visual.config.ts`
  - `docs/design/TESTING.md`
  - `docs/design/D8-report.md`
- **Changed:**
  - `package.json`: `test:visual` and `test:visual:update`
  - `e2e/components/design-routes.spec.ts`: axe at 390px
