# D4 · Home and Library re-skin (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only: no change to any API handler, route, permission, server action,
SQL, billing, auth, roles or claim copy. Prices, age and Guardian rules, and teens' simulated practice are unchanged.
Built only on the D1–D3 primitives: tokens, Ascentra font, `Icon`, `Glass`, `Button` classes, `Segmented`, tilt,
motion, the shell.

## Scope

- **Home** (`/`):
  - the visitor Hall hero (title in the Ascentra font);
  - the signed-in head: an eyebrow, the title in the Ascentra font, the unchanged account line;
  - the learner's Up next row, stats strip and section cards.
- **Library** (`/learn`, the course list; D0 mapped the prototype's Library here): a filter, search, and course cards.
- **Review: skipped entirely.** The learner Review page has no route and no real data (decision 7). No route and no
  Demo deck were created.
- **Sky control: not added.** No visible sky control exists today. The Hall's `?phase=` switch is a review aid on dev
  servers and previews, not a control for learners.
- **Not restyled:**
  - the track pages (`/learn/track/[slug]` and its library) and other learner pages;
  - the signed-in Home's existing feature, how-it-works, status and closing sections below the head. They are not
    redesigned, but their surfaces now follow the theme (see below).

## One thing to know: Home now reads the learner's progress

The prototype's Home (Up next, stats, current sections) needs real progress, which Home never read before.

- **What it reads:** Home now makes one read, `GET /api/v1/learn/progress`. It's the same endpoint and the same
  reader (`progressFrom`) that My progress already uses. No API, route or permission changed.
- **Who:** only for signed-in roles that learn (not Guardians: tested, no request is made). That's the same rule as the
  HUD tabs and Home's existing Learn links.
- **When it can't:** if the read fails or there is no active course, those blocks are simply absent, and the account
  line stays as before (tested).

If you'd rather Home make no new read, the blocks can be removed and Home goes back to its title and account line;
nothing else depends on them.

## What changed

### Home (signed in, learning roles)

- **Up next:** a glass row naming the first open, unfinished section of the current course, with the Iris/Mono
  primary **Continue**. It links to the course's existing page: `/learn/track/<slug>` for a skill track, `/learn`
  otherwise. It's hidden when nothing is open (for example, everything left is locked).
- **Stats strip (real only):**
  - **Rank:** the named tier and points (never a position like "#12");
  - **Streak:** current, with the best;
  - **Sections:** sections done in the current course or Round;
  - **Rounds:** only for tracks.
  - Numbers use the app's own CountUp. The API's own note shows under the strip: "Ranks and streaks come from items you
    finish. Results vary. Nothing here promises income."
- **Section cards:** the current Round's (or course's) sections, each with a number tile, title, items done and a
  state chip in words (Done, Open, Half open, Locked, with the lock reason). These are the only elements that tilt
  (decision 6). Up next, the stats and the HUD never tilt (tested).
- **Which course:** the first active course that isn't complete; paused courses are skipped. For tracks, the current
  Round is the first open Round that isn't complete (`homeView`, unit-tested).

### Visitor Home (Hall)

- The title is now in the Ascentra font (caps-only, so it reads in capitals; the accent word stays the theme's frost
  colour, upright, because the face has no italic).
- The lede is slightly larger. Copy, buttons, the plan note, prices and rules are identical. The photo keeps its
  original colours in both themes.

### Library (`/learn`)

- **Same reads:** the two existing reads (path, then courses) and every lesson link, label and fact
  ("8 min · last verified … · done") are unchanged.
- **Quick links:** My path, Choose your path, My progress, Notebook, Leaderboard and Community are the same links,
  restyled as small glass buttons in a labelled nav.
- **Filter:** a segmented control with All, Taking (any lesson done) and Not started, from the lessons' own done flags.
- **Search:** over course, module and lesson titles, with a live count ("1 of 3 courses match.").
- **Course cards (glass):**
  - a cover tile (an icon chosen from the slug, plus the accent);
  - the title in the Ascentra font, and meta ("3 modules · 5 lessons");
  - a status chip (In progress, Not started or Done);
  - a small lessons-done bar ("3 of 5 lessons done");
  - a Show/Hide lessons toggle (`aria-expanded`).
  The first card is featured: full width and open. Every lesson link remains (tested).
- **No income claims on any card** (tested). The cards hold several links, so they don't tilt.

### Old panels follow the theme (restyled pages only)

On `main.ds-page` (Home and `/learn`), the D2b surfaces (`.ui-block`, `.ui-tile`, `.ui-rows`, `.ui-card` …) now take
their fill, edge and spotlight from the theme tokens (`app/styles/pages.css`). Iris looks as before; Mono is
graphite (tested). Other pages are untouched until they're restyled.

## Iris primary button contrast (Home, Up next "Continue")

Measured in Chromium behind the text, over five samples of the iridescent drift, with the specular highlight forced
to full strength ([`shots/d4-primary-button-contrast.json`](shots/d4-primary-button-contrast.json)):

| Theme / glass / width | Ink | Worst | Median |
|---|---|---|---|
| Iris / Frosted / 1280 | white | **5.12:1** | 5.87:1 |
| Iris / Liquid / 1280 | white | **4.98:1** | 5.94:1 |
| Iris / Frosted / 390 | white | **5.04:1** | 6.92:1 |
| Mono / Frosted / 1280 | #1a1408 | **9.84:1** | 12.19:1 |

All are at least 4.5:1. The Library has no primary button.

## Screenshots (`docs/design/shots/`)

Rendered in Chromium from the real components and stylesheets, with test data shaped exactly like the API answers
(`e2e/components/fixtures/d4-data.ts`; no real learner). The app server can't start here without secrets.

- **Before** (10): `d4-before-{home|library}-{iris|mono}-frost-{1280|390}.jpg`, `d4-before-hall-visitor-{iris|mono}-1280.jpg`
- **After** (20): `d4-after-{home|library}-{iris|mono}-{frost|liquid}-{1280|390}.jpg`, `d4-after-hall-visitor-{iris|mono}-{1280|390}.jpg`
- **Regenerate:** `DESIGN_SHOTS=1 DESIGN_SHOTS_TAG=after npx playwright test -c playwright.components.config.ts d4-shots`
  (skipped otherwise; CI never runs it).

## Tests and checks

- **New Chromium spec** `e2e/components/design-pages.spec.ts` (8 tests; 32/32 over repeated runs), checking:
  - Home: Up next, real stats (tier, points, streak, sections), five section cards with their chips and lock reason;
    only those tilt;
  - a Guardian never reads progress, and a failed read hides the blocks;
  - Library: filter, search and count, featured card, chips, bar, every lesson link, no income claims, no tilt;
  - 390px: no horizontal overflow on both pages;
  - Motion Reduced and Off: no `ds-`, `lib-`, `hud-` or `bd-` animation and no tilt on either page;
  - the old panels are graphite in Mono.
- **New unit tests** `tests/unit/d4-pages.test.ts`: `homeView` (module course, track Round, paused and finished
  skipped, nothing open) and the Library's counts, status and search.
- **Results:**
  - lint ✔
  - typecheck ✔
  - unit tests 60 files, 4246 passing ✔
  - build ✔
  - component tests 140 passing (38 screenshot-only tests skipped) ✔
  - check:bundle ✔
  - check:build-secrets not run (needs real secrets)
- **No product failures** this stage. Three test-side corrections:
  - the harness's stylesheet list now includes the new D4 files;
  - one test assumption about which card starts open;
  - one assertion rewritten to check the cards' combined text.

## Files

- **New:**
  - `app/home-progress.tsx`
  - `app/home.css`
  - `app/learn/library.css`
  - `app/styles/pages.css`
  - `e2e/components/{design-pages,d4-shots}.spec.ts`
  - `e2e/components/fixtures/d4-data.ts`
  - `tests/unit/d4-pages.test.ts`
  - `docs/design/shots/d4-*`
- **Changed:**
  - `app/page.tsx`: `ds-page`, eyebrow, HomeProgress, `home.css`
  - `app/learn/page.tsx`: `ds-page`
  - `app/learn/learn-list.tsx`: presentation only; same reads and links
  - `app/layout.tsx`: `pages.css`
  - `e2e/components/fixtures/shell-harness.ts`: an `api` option, the new stylesheets

## Noted for later

- A card that was featured while a search showed it alone stays open after the search is cleared (its own open state).
  This is harmless, and the learner can close it.
- The signed-in Home's lower sections (features, how it works, status, closing) are the visitor landing's; whether
  members should see them is a content decision for a later stage.
