# Small fixes: report

Branch `claude/small-fixes-audit` (on top of `docs/small-fixes-audit.md`), from the Owner's answers to the audit's six
questions. No SQL, no migration, no Vercel variable, no permission, price, age or Guardian rule changed. The renewal
terms text was not touched. No route was called against a live service and no course was started.

## Changes

| # | Owner answer | Change | Files |
|---|---|---|---|
| 1 | Trial label from the server; banner says "Billing" and opens the section | The Plan fact uses `planLabel()`, which builds "14-day free trial, then Basic ($20/mo)" from `trialDays` and Basic's price sent by `GET /api/v1/billing` (both from `lib/billing-terms.ts`). The Billing section has `id="billing"`. The payment-failed banner link says **Billing** and goes to `/account#billing` (the Guardian's link to the Guardian Center is unchanged) | `app/billing-api.ts`, `app/account/billing-panel.tsx`, `app/billing-banner.tsx`, `app/api/v1/billing/alerts/route.ts` |
| 2 | Home line from `adminLinksFor`, add Progress | The hand-written admin link groups are replaced by `adminLinksFor(me.roleKey)` (the list `/admin` uses). Every role keeps exactly the links it had; the Owner also gets **Import course** and **Missions and leaderboard**, which `/admin` already listed for the Owner. **Progress** (`/learn/progress`) is added after Learn · My path · Choose your path, for everyone but Guardians | `app/account-panel.tsx` |
| 3 | "Learn · My progress" in the Account breadcrumb, not for Guardians | New `LearnCrumbs` client piece (uses the shared `useMe`); shown once the account is known, hidden for Guardians. Breadcrumb: Home · Learn · My progress · Sign out | `app/account/learn-crumbs.tsx`, `app/account/page.tsx` |
| 4 | Start course refuses skills | `startTopicCourse` returns 400 "A skill is a track of 3 Rounds: import it from Import course." for a skill topic, before anything is linked, estimated or queued (audited as Blocked, as other refusals are). Businesses and side hustles are unchanged | `lib/picks/picks.ts` |
| 5 | Owner exemption: no change | Nothing touched | — |
| 6 | Admin link: no change | Nothing touched; `admin-links.ts` and `admin-links.test.ts` unchanged | — |

## Tests

- New `tests/unit/small-fixes.test.ts`: the trial label (14 days and $20/mo from the terms; follows other values), the
  locked prices, the panel has no typed "14-day" and has `#billing`, the banner text and both `/account#billing` links,
  each role's Home admin links equal to before (plus the Owner's two), Progress for non-Guardians, and the Account
  breadcrumb's Guardian check.
- `tests/unit/picks.test.ts`: Start course refuses a skill for the Owner and a Course Admin (estimate and confirm),
  changes no data, records only Blocked events; a business still gets its estimate. Runs on the in-memory fake.
- `tests/unit/b4.test.ts`: the payment-failed alert's link is now `/account#billing`.
- `tests/unit/design-tokens.test.ts`: the style-guide link check now reads `admin-links.ts` (Owner and Super Admin
  only) and checks the Home line uses `adminLinksFor`.
- `tests/unit/admin-links.test.ts`: unchanged, passing.

## Checks (run on this branch)

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass (after one fix: the new test passed `t.id`, typed `unknown`, as a string; now `String(t.id)`) |
| `npm test` | Pass: 65 files, 4296 tests (one earlier fix to the new test: it read `r.reason` instead of `r.body.reason`) |
| `npm run build` | Pass |

`npm ci` was run first: the container had no `node_modules`. Integration, database and visual suites need live
services and were not run.

## Left as is (outside these answers)

- Renewal reminder and payment notices (`lib/notices.ts`) and the Mentor's refusal text (`lib/mentor/mentor.ts:349`)
  still say "Plan and billing" and link to `/account`. They are notice and refusal copy, so they were not changed;
  they can be aligned to "Billing" in a later step if you want.
- Comments in `app/api/v1/billing/route.ts:12` and `lib/caps.ts:118` say "Plan and billing" (comments only).
