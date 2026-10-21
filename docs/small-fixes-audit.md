# Small-fixes audit (report only)

Read on `main` (pulled, already up to date) on 2026-10-21. No code was changed and nothing was called on a live service.
Inputs: `docs/design/decisions.md`, `docs/design/D0-audit.md`, `docs/SKILL-TRACKS.md`, and the Account, Billing, Home,
Learn, Admin, device and sharing code cited below. Line numbers are for `main` at the time of reading.

Locked facts used as the yardstick: **Basic $20/mo, Pro $50/mo, 14-day trial that then continues as Basic.**
The source of truth for these in code is `lib/billing-terms.ts:10-14` (`PLANS.basic.cents = 2000`, `PLANS.pro.cents = 5000`,
`TRIAL_DAYS = 14`). Every price figure below matches it; nothing in the app shows a wrong price.

---

## 1. Billing labels (Account → Billing)

### What the code does today

All labels below are in `app/account/billing-panel.tsx` unless noted. Prices and trial length come from the server
(`app/api/v1/billing/route.ts:36-39`, which reads `lib/billing-terms.ts`), except where marked **hard-coded**.

| # | Where | Label today | Matches locked facts? |
|---|---|---|---|
| 1 | `:122` section heading | "Billing" | Yes, but other places call it "Plan and billing" (see 15, 16) |
| 2 | `:125` fact `Access` | `TIER_LABEL` (`:32`): "No plan" · "Trial (Basic features)" · "Basic" · "Pro" · **"Full access (Owner)"**, plus " (from your role)" when the tier comes from a staff role | Yes. Note: "Full access (Owner)" only ever shows for the Owner (`lib/billing.ts:271`) |
| 3 | `:128` fact `Plan` | `PLAN_LABEL` (`:30`): **"14-day free trial (converts to Basic)"** · "Basic" · "Pro" | Correct today, but **"14" is hard-coded** while everything else reads `trialDays` from the server. Basic/Pro rows show no price |
| 4 | `:129` fact `Status` | `STATUS_LABEL` (`:31`): "Trial" · "Active" · "Payment failed: Stripe is retrying. Update your payment method." · "Canceled" | Yes. The `past_due` text is a sentence, not a label |
| 5 | `:130` | "Trial ends" + date | Yes |
| 6 | `:131` | "Next charge" + `$20.00 on <date>` (server: plan price + Mentor add-on, `route.ts:32`; a trial's next charge is priced as Basic) | Yes |
| 7 | `:132` | "Access until" + date + "You won't be charged again." | Yes |
| 8 | `:139`, `:142` buttons | "Manage billing" · "Cancel plan" | Yes |
| 9 | `:151` | "Your Guardian manages this plan." | Yes |
| 10 | `:155` | "Mentor allowance" (add-on, not a plan) | n/a |
| 11 | `:169` | "Plans aren't available yet." | Yes |
| 12 | `:173` legend | "Choose a plan" | Yes |
| 13 | `:179-181` plan choices | "**Basic** $20.00 per month · starts with a free 14-day trial" and "**Pro** $50.00 per month" | Yes. Shown as "$20.00 per month", not "$20/mo" |
| 14 | `:199-202` consent | Trial: "after my free trial ends on <date>, I'll be charged $20.00 every month until I cancel." Pro: "I'll be charged $50.00 today and every month after…" | Yes. Does not say the word "Basic" in the trial sentence |
| 15 | `:214` submit | "Start my 14-day trial" · "Continue to checkout · $50.00 today" · "Continue to checkout" | Yes |
| 16 | `app/billing-banner.tsx:29` | Payment-failed banner link text **"Plan and billing"** → `/account` (no `#billing` anchor) | Name differs from the heading "Billing" |
| 17 | `lib/billing-terms.ts:22-28` | Automatic Renewal Terms text ($20.00 / $50.00 / 14-day / converts to Basic) and "cancel any time from the **Billing section** of your Account page" | Yes. This text is a legal record (see risk) |
| 18 | `app/api/v1/billing/route.ts:12` comment | "Account → Plan and billing" | Comment only |

Related labels outside Account (all correct, listed for completeness): `app/guardian/guardian-center.tsx:211-212`
("Basic, $20.00/month (14-day free trial first)"), `app/landing/hall/hall.tsx:92,98` ("Start your 14-day trial",
"14-day trial, then Basic at $20/month"), `app/page.tsx:33` ("Basic or Pro. Basic can start with a free trial."),
`app/learn/path/path-page.tsx:63` ("Account → Billing"), `app/learn/choose/choose-page.tsx:77` ("Plans and the free trial").

### What you most likely meant

No label states a wrong price or trial length. The two that are wrong-ish or unclear:
- **`PLAN_LABEL.trial` (`:30`)**: hard-coded "14-day", and "converts to Basic" wording differs from the locked phrase
  "then Basic" and from the landing ("continues as Basic"). Basic and Pro rows show no price.
- **Heading vs banner name**: "Billing" (`:122`) vs "Plan and billing" (`billing-banner.tsx:29`), and the banner link
  lands on the top of `/account`, not the billing section.

### Smallest safe change

- `:30`: build the trial label from `data.trialDays` (e.g. "Free trial: 14 days, then Basic ($20/mo)"), and optionally
  add the price to Basic/Pro via `data.plans`. One file.
- Pick one name ("Plan and billing" or "Billing") for `:122` and `billing-banner.tsx:29`; add `id="billing"` to the
  section and point the banner at `/account#billing` (`app/api/v1/billing/alerts/route.ts:23,29`).
- Do **not** touch `RENEWAL_TERMS_BODY` for wording only.

### Risk

Low for items 3 and 16. **High for 17**: the checkout route refuses when the stored terms text differs from
`RENEWAL_TERMS_BODY` (`lib/billing-terms.ts:4-5`), so editing it needs a new terms version and a database row.

### Tests affected

`tests/unit/billing.test.ts` (check for string matches before editing); no test matches the `:30` or banner strings
found by search. Journeys under `tests/journeys` may match button text ("Start my 14-day trial"); leave that unchanged.

### SQL / Vercel variable / permission

None for the label fixes. Changing the terms text would need SQL (a new `legal_document_versions` row).

---

## 2. "Start course" for skills: server route or client?

### What the code does today

- The **Start course** button is `StartCourse` in `app/admin/topics/topics-admin.tsx:120-156`. It is a client
  component, but it does no work itself: it calls the server route **`POST /api/v1/topics/{id}/course`**
  (`:125-136`), first for the estimate, then with `{ confirm: true, expectedTotalUsd }`.
- That route is `app/api/v1/topics/[id]/course/route.ts:9-14` (`withCap("catalog.queue")`, audited), which calls
  `startTopicCourse` in `lib/picks/picks.ts:384-418`. It allows only the Owner or a Course Admin (`:386`), links the
  topic to a catalog topic, and queues a **module course** with `structure: 2` and a size tier (`:411-412`).
- **For skills there is no Start course button.** `topics-admin.tsx:93-96`: a skill shows "Track (3 Rounds)" and, for
  the Owner only, an **"Import it"** link to `/admin/import`. Tracks are made by importing a version-2 file
  (`docs/SKILL-TRACKS.md`; `POST /api/v1/courses/import/check` and `POST /api/v1/courses/import`, called from
  `app/admin/import/import-page.tsx:48`). That is also a server route.
- **Gap found:** `startTopicCourse` never checks `t.kind`. A direct `POST /api/v1/topics/{id}/course` for a **skill**
  topic (by the Owner or a Course Admin, outside the UI) would queue a normal module course (Compact/Standard/Large),
  not a 3-Round track, and spend AI budget on the wrong structure. The UI hides this; the server doesn't refuse it.

### What you most likely meant

Starting a course already runs on the server. What is missing is a **server-side refusal for skills**, so the only
way to create a skill track is the import (built free in chat first), matching the UI.

### Smallest safe change

In `lib/picks/picks.ts` `startTopicCourse`, after the topic is read (`:390`), refuse when `t.kind === "skill"` with a
400 such as "A skill is a track: import it from Import course." No new route. Nothing was called to verify this.

### Risk

Low: it only removes a path the UI never offers. It is audited as a Blocked `catalog.queue` event.

### Tests affected

Add one case to `tests/unit/picks.test.ts` (or a route test). `tests/gate1/routes-by-role.test.ts` lists route →
capability and is unaffected.

### SQL / Vercel variable / permission

None. (It narrows what an existing permission can do, but no role changes.)

---

## 3. Home account line: links by role

### What the code does today

The account line is `AccountPanel` in `app/account-panel.tsx`, rendered on Home at `app/page.tsx:54`. Every link group
and its role check:

| Line | Links | Owner | Super Admin | Course Admin | Reviewer | Support | Guardian | Learner |
|---|---|---|---|---|---|---|---|---|
| `:45-49` | Audit log · Safety review · Style guide | ✓ | ✓ | | | | | |
| `:50-54` | Source library · Course builder | ✓ | ✓ | ✓ | ✓ | | | |
| `:55-59` | Topic catalog | ✓ | | ✓ | ✓ | | | |
| `:60-64` | Owner review | ✓ | | | | | | |
| `:65-69` | Course requests | ✓ | | ✓ | | | | |
| `:70-74` | Topics | ✓ | ✓ | ✓ | | | | |
| `:75-79` | Learn · My path · Choose your path | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `:80-84` | Account safeguards | ✓ | ✓ | | | ✓ | | |
| `:85-89` | Guardian Center | | | | | | ✓ | |
| `:90` | Account and devices · Sign out | all | all | all | all | all | all | all |

The line starts "Signed in as <name> (<role label>)" (`:43`, labels from `lib/caps.ts:19-27`). A learner also gets
the second-factor tip (`:93`).

Differences from the Admin home list (`app/admin-links.ts:8-21`): the account line **omits "Import course" and
"Missions and leaderboard"** (both Owner only), and **omits "Progress"** (`/learn/progress`), which the app HUD tabs
do show (`app/ui/shell/app-hud.tsx:23`).

### What you most likely meant

The account line shows too many admin links for staff roles, or they should come from one list. Today it is a
hand-written copy of `ADMIN_LINKS` that has drifted (two Owner links missing).

### Smallest safe change

Either (a) show only "Admin" (already in the HUD) and drop the admin links from the line, or (b) render the admin
links from `adminLinksFor(me.roleKey)` (`app/admin-links.ts:25`) so the two lists can't drift. Both are one file;
(b) keeps today's behavior plus the two missing Owner links. Await your answer (Q2).

### Risk

Low: links only; every admin page and API still checks the role on the server.

### Tests affected

`tests/unit/design-tokens.test.ts:70-71` matches the exact Audit log · Safety review · Style guide markup in
`account-panel.tsx` and would need updating. `tests/unit/admin-links.test.ts` is unaffected unless the list changes.

### SQL / Vercel variable / permission

None.

---

## 4. Account page: Learn / My progress links

### What the code does today

- `app/account/page.tsx:17-20`: the only in-page navigation is the breadcrumb **"Home · Sign out"**. The page has no
  link to Learn, My path or Progress.
- The page section "Progress and leaderboard" (`app/account/progress-settings.tsx:45-46`) is settings only; it has no
  link to `/learn/progress`.
- The sticky app HUD on `/account` (`app/ui/shell/app-hud.tsx:10,23`) does show **Learn · My path · Progress** tabs for
  every role except Guardian. So the links exist on the page via the HUD, but not in the Account content.
- Home's account line links Learn and My path but **not** Progress (`account-panel.tsx:77`).
- No route is wrong: `/learn` and `/learn/progress` both exist (`app/learn/progress/page.tsx`).

### What you most likely meant

A visible "Learn · My progress" link on the Account page itself (breadcrumb or the Progress section), and possibly
"My progress" on Home's account line.

### Smallest safe change

`app/account/page.tsx:19`: add `<Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link>`
to the breadcrumb, hidden for Guardians (the page is a server component, so either always show them and let
`/learn` handle Guardians, or move the check into a small client piece using `useMe`). Optionally add
"My progress" to `account-panel.tsx:77`.

### Risk

Low. Guardians would see a Learn link that doesn't apply to them if the role check is skipped.

### Tests affected

None found that match the Account breadcrumb. `design-tokens.test.ts:71` is unaffected by a change to line 77.

### SQL / Vercel variable / permission

None.

---

## 5. Owner and the account-sharing / device checks (describe only)

### What the code does today

| Check | Where | How the Owner is treated |
|---|---|---|
| Trusted-device requirement on every API route | `lib/auth/require-cap.ts:160-162` | **Same as everyone**: a request from an untrusted browser gets 403 `device_not_trusted` |
| Device limit (3) | `lib/security-config.ts:8`; `lib/devices.ts:121-127` (`claim_device_slot`) | **Same as everyone**: a 4th browser is held until one is replaced |
| Replacing a device | `lib/device-actions.ts:88-116` | Needs the second-factor check like everyone; **exempt from the Limit block** (`:99`). Each replacement still adds a sharing signal (`:115`) |
| One session at a time | `lib/sessions.ts:111-131` | **Same as everyone**: a new session pauses the others |
| Sharing signals (replacements, overlapping sessions, distant sign-ins) | `lib/sessions.ts:132,159`; `lib/sharing.ts:47-91` | **Recorded and scored for the Owner too**; a flag is raised and audited |
| Automatic steps Notice → Verify | `lib/enforcement.ts:92-108` | **Applied to the Owner too**. `effectOf` (`:63-75`) sets `needsVerify`/`noticeUnread` for the Owner, so the Device gate shows the Verify screen (`app/device-gate.tsx:108`) |
| Limit and Suspend | `lib/enforcement.ts:12,62-72,141`; DB trigger `db/migrations/0007_devices_and_sessions.sql:187-203` | **Owner exempt**, in code and in the database |
| Enforcement read failure | `lib/auth/require-cap.ts:151-155` | Owner gets no enforcement (fail-open); others get an error |

### What exempting the Owner would change

Depending on how far it goes: the Owner would no longer hit the 3-device cap, would not have sessions paused, would
generate no sharing signals or flags, and would never see Notice/Verify. The Owner is already exempt from Limit and
Suspend, so the remaining effect is mostly on devices, sessions and Notice/Verify.

### Risk (flagged; no code proposed)

- **Security:** the Owner account is the most powerful one. Sharing signals and the Verify step are the main
  automatic signal that the Owner's login is being used by someone else. Exempting it removes that alarm for the one
  account where a takeover costs most.
- The trusted-device requirement is also a defence against a stolen session; exempting it from device checks widens
  the impact of a leaked Owner session.
- It is a permission change: it needs your explicit decision, a note in the audit/security docs, and review.
- Tests: `tests/unit/devices-sessions.test.ts` drives the Owner through devices and sessions (`:50`, `:284`,
  `:558-560`) and would change.
- SQL: a full exemption from signals could be code-only; a database-level guarantee (like the 0007 trigger) would need
  a migration. No Vercel variable needed.

---

## Admin link: where it shows and for whom

- **Where:** `StaffNav` (`app/staff-nav.tsx:13-21`), rendered inside the app HUD (`app/ui/shell/app-hud.tsx:69`) on
  pages with the shell, and on its own on other pages (`:52`). One link: "Admin" → `/admin`.
- **Who:** `isStaff` in `app/admin-links.ts:23-24`: **Owner, Super Admin, Course Admin, Reviewer, Support** see it;
  Learner and Guardian don't.
- **`/admin` itself** (`app/admin/page.tsx`) lists `adminLinksFor(role)`; its links Audit log · Source library are
  fixed in the header (`:10`) for anyone who opens it. Each admin page and API checks the role on the server.

**If restricted to the Owner only:** Super Admin, Course Admin, Reviewer and Support lose the "Admin" entry. They keep
their direct links on Home's account line (section 3), so Course Admin and Reviewer can still reach Course builder,
Source library and so on; **Support keeps only "Account safeguards"**; Super Admin keeps Audit/Safety/Style guide/
Topics. They lose the `/admin` home and its Administrators and Adjustments panels as an entry point (those still
refuse by role on the server). Tests: `tests/unit/admin-links.test.ts:10-14` asserts the five staff roles and would
fail. No SQL, Vercel variable or permission change: it is a link, not access. Not changed.

---

## Questions for the Owner

1. **Billing label:** which label did you mean? *Recommended:* the trial label "14-day free trial (converts to Basic)"
   → read the days from the server and say "then Basic ($20/mo)"; leave the legal terms text untouched.
2. **Home account line:** keep the per-role admin links, or show only "Admin" plus Learn/My path/Progress?
   *Recommended:* build the links from `adminLinksFor` so they match `/admin`, and add "Progress".
3. **Account page links:** add "Learn · My progress" to the Account breadcrumb for everyone except Guardians?
   *Recommended:* yes, breadcrumb only.
4. **Start course for skills:** should the server refuse `POST /api/v1/topics/{id}/course` for skill topics, so
   tracks can only come from an import? *Recommended:* yes.
5. **Owner exemption:** which checks, if any, should skip the Owner: device cap, single session, sharing signals,
   Notice/Verify? *Recommended:* none for now; at most raise the Owner's device cap, and keep signals and Verify.
6. **Admin link:** restrict to the Owner only, given Support would then reach only Account safeguards?
   *Recommended:* keep it for all staff; per-page server checks already limit what each role can do.
