# D6 · Every remaining route (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only, built from the D1–D5 primitives and tokens; no one-off styles.
The `app/` diff is three kinds of change and nothing else:

- **Markup:** the `className` of each route's `<main>`.
- **Admin home:** one icon per admin tile.
- **Pointer effects:** two small checks so calm pages get none.

No behaviour, permission, data fetch, route, SQL, API handler or copy changed. A diff check confirms every other changed
line is a `<main className>`.

## How it works

- **Restyled pages:** `<main class="ds-page">`. The shared rules live in `app/styles/pages.css` (new D6 section) and
  apply only under `main.ds-page`, so a page without the class keeps its old look. A unit test checks every D6
  selector is scoped this way.
- **Calm pages:** these also get `ds-page--calm`:
  - Admin
  - Account (which holds Billing, Privacy and Devices)
  - Guardian Center and Pro
  - sign-in, sign-up and onboarding (`/welcome`)
  - the device and session alerts
  - credits, not-available, not-open, 404 and the error page
- **What every restyled page gets:**
  - **Theme tokens:** panels, wells, fields, checkboxes, glass cards and the page wall take the theme tokens, so Mono is
    graphite and no Iris navy is left (tested on four routes).
  - **Kept colours:** the legal (gold), notice, AI and status colours keep their meaning.
  - **Primary buttons:** existing primaries (`.ui-btn--primary`, `button.primary`) use the design-system primary:
    iridescent on a dark base in Iris, champagne in Mono.
  - **Type:** page titles, section headings and small-caps labels use the Ascentra font (decision 2); body text stays
    Geist.
  - **Motion setting:** the shared page entrance and scroll reveals now follow Motion Reduced and Off, not only the
    device setting.
- **What calm pages give up:**
  - no tilt, no pointer spotlight, no cursor glow or click spark;
  - the rim and highlight don't follow the pointer, and the backdrop doesn't lean;
  - no backdrop drift, dust, rays or breathing;
  - no gloss sweep, no HUD tab pulse, no icon animation, no scroll reveal;
  - the primary button stays still.

  Only the shared entrance remains. Admin keeps its D3 dense layout and still has no entrance. Its panels are now
  glass-toned, without blur: admin has no backdrop and stays fast.
- **Admin home:** the admin pages are now a grid of tiles with icons. Which links show is unchanged (`adminLinksFor`),
  and so is the HUD's Admin link (Owner and staff, as before). Only the Owner manages admin roles (unchanged).

## Routes

| Route | Result | Notes |
|---|---|---|
| `/admin` (Administrators, refunds and credits) | Restyled, calm | Tiles with icons; same links per role |
| `/admin/audit` | Restyled, calm | Glass panels, dense sticky-header table, labels in Ascentra caps |
| `/admin/safety` | Restyled, calm | |
| `/admin/security` (Account safeguards) | Restyled, calm | |
| `/admin/review` (Owner review) | Restyled, calm | |
| `/admin/import` | Restyled, calm | |
| `/admin/topics`, `/catalog`, `/course-requests`, `/courses`, `/courses/[slug]`, `/sources`, `/missions` | Restyled, calm | |
| `/account` (Billing, Privacy, Devices, Progress, Appearance) | Restyled, calm | Billing copy, prices and terms unchanged |
| `/guardian` | Restyled, calm | Guardian rules and copy unchanged |
| `/pro` | Restyled, calm | Refusal for Basic and trial unchanged |
| `/sign-in`, `/sign-up`, `/welcome` | Restyled, calm | The app's own card, button and type; see Clerk below |
| `/not-available`, `/not-open`, `/credits`, 404, error page | Restyled, calm | |
| Device and session screens (`app/device-gate.tsx`) | Restyled, calm | Alerts keep the gold notice |
| `/learn/[id]` (Section) | Restyled | Primary drifts while motion is on; graded and practice frames keep their meaning |
| `/learn/track/[slug]`, its library, `/learn/capstone/[id]` | Restyled | |
| `/learn/path`, `/learn/choose`, `/learn/leaderboard`, `/learn/notebook`, `/community` | Restyled | |
| `/`, `/learn`, `/learn/progress` | Already D4/D5 | Home keeps its D4 look (D6 rules skip `.landing`). My progress's older sections now share the D6 headings and primary. |
| `/admin/style-guide` | **Skipped** | Internal showcase of the old base components; restyling it would misrepresent what it documents |
| `/dev/course-ui` | **Skipped** | Internal showcase of the course UI (not glass by design); never on production |
| `/dev/design` | Already D1–D3 | The design preview |
| Clerk's hosted forms (password sign-in fallback, sign-up form, Account's Sign-in methods) | **Skipped** | Clerk needs literal colours (`app/clerk-appearance.ts`) and can't render here without Clerk keys, so the Mono look can't be checked. They keep the Iris palette inside the restyled card. |

## Iris primary button contrast

From [`shots/d6-primary-button-contrast.json`](shots/d6-primary-button-contrast.json). Measured behind the text over
six samples:

| Page / theme / glass / width | Worst | Median |
|---|---|---|
| Sign-in (calm, still) / Iris / Frosted / 1280 | **7.39:1** | 8.1:1 |
| Sign-in / Iris / Liquid / 1280 | **7.39:1** | 8.1:1 |
| Sign-in / Iris / Frosted / 390 | **7.39:1** | 8.1:1 |
| Sign-in / Mono / Frosted / 1280 (dark ink) | **9.0:1** | 11.24:1 |
| Section (drifting) / Iris / Frosted / 1280 | **6.91:1** | 7.93:1 |
| Section / Iris / Liquid / 1280 | **7.06:1** | 8.11:1 |
| Section / Iris / Frosted / 390 | **6.91:1** | 8.13:1 |

## Screenshots (`docs/design/shots/`)

Rendered in Chromium from the real pages and stylesheets, with test data shaped like the API answers
(`e2e/components/fixtures/d6-data.ts`, marked TEST DATA). The app server can't start here without secrets.

- **Pages shown:** admin, audit, safety, owner-review, import, account-billing, guardian, sign-in, welcome,
  section, track and path.
- **Before** (24): `d6-before-{page}-{iris|mono}-frost-1280.jpg`, taken from the D5 commit.
- **After** (44):
  - `d6-after-{page}-{iris|mono}-frost-1280.jpg`
  - 390px for admin, audit, account-billing, guardian, sign-in and section
  - Liquid at 1280px for admin, guardian, sign-in and section
- **Regenerate:** `DESIGN_SHOTS=1 DESIGN_SHOTS_TAG=after npx playwright test -c playwright.components.config.ts d6-shots`

## Tests and checks

- **New unit test** `tests/unit/d6-routes.test.ts` (6 tests):
  - every page's `<main>` is restyled or in the skip list;
  - the calm list is exact;
  - every D6 selector is scoped to `main.ds-page`;
  - the calm rules;
  - the pointer listener and the spark skip calm pages;
  - the entrance follows Motion.
- **New Chromium spec** `e2e/components/design-routes.spec.ts` (7 tests, 14/14 over two runs), over 29 routes:
  - restyled and calm where expected, with titles in the Ascentra font;
  - calm pages: no glow or spark, no tilt, nothing looping (a learner page sparks on the same click, so the check can
    fail);
  - no navy left in Mono;
  - no sideways scroll at 390px;
  - Motion Reduced and Off: no entrance, drift or gloss.
- **Changed test:** the D3 cursor-glow test moved from Account (now calm) to the Library, and also checks Account
  stays calm.
- **Harness, test only:**
  - the harness renders every route's real page;
  - the test's API answers come before the default registration answer;
  - a route can answer with a non-200 status (Pro's 403);
  - Clerk's `SignIn`, `SignUp` and `useSignIn` are stood in.
- **Results:**
  - lint ✔
  - typecheck ✔
  - unit tests 62 files, 4263 passing ✔
  - build ✔
  - component tests 156 passing (72 screenshot-only tests skipped) ✔
  - check:bundle ✔
  - check:build-secrets not run (needs real secrets)

## Failures and fixes (one attempt each)

1. **D3 cursor-glow test:** failed because Account is now calm, which is intended. The test moved to the Library.
2. **D6 unit test:** caught one drift rule that also reached Home (fixed in `pages.css`), plus a mistake in the test's
   own selector splitting.
3. **Route spec:**
   - **Mono check:** found the `<html>` wall still Iris behind the backdrop. Now themed on every restyled page.
   - **Calm check:** found the HUD's active-tab pulse looping on the Guardian Center. Now held still on calm pages.
   - **Test-side only:** two time limits, a real click that started a page's own action (replaced by a synthetic click,
     with a positive control), and the admin tiles' list bullets.

## Noted for later

- Clerk's hosted forms: theme them once they can be checked with Clerk running, either by CSS variables if Clerk
  accepts them, or by an appearance object per theme.
- The lesson lede keeps the older serif headline face; only headings moved to Ascentra.
