# The 18th-birthday switch (S2)

Plan: the "18th-Birthday Switch Plan" doc. Owner decisions (Oct 29, 2026): a Guardian-paid plan runs to the end of the
paid period and then the learner opts in; warnings 30 and 7 days before; courses blocked until the adult agreements are
accepted. AI-assisted work, not reviewed by an attorney.

## What is built (branch `claude/age-up-switch`)

- **Migration 0024 / bundle `db/apply/S2.sql`.** `public.age_up_account(uuid)` is the only place `is_minor` goes from
  true to false. It switches only an **active** teen who is 18 by the same US-date rule as sign-up, closes the Guardian
  link first (the link rule in 0010 refuses changes once the teen is an adult), then sets `is_minor = false`,
  `aged_up_at` and `adult_agreement_due`. A teen who is pending or paused is held (`held_status`), not switched.
  `public.age_up_candidates()` lists active teens who turn 18 within 30 days. Both are service-role only.
- **Daily job** `/api/cron/age-up` (vercel.json, 06:11 UTC): warns at 30 and 7 days (once per window, learner and
  Guardian), switches on the day, sets a Guardian-paid Stripe subscription to cancel at the period end, and records
  audit events (`accounts.age_up`, `accounts.age_up.held`). Rules are pure and unit-tested (`lib/age-up-rules.ts`).
- **Notices** `turning_18_notice` and `turned_18` (`lib/notices.ts`), by email, one per window.
- **verify.sql** reports S2.

## Not built yet (do before any teen can use the site)

1. **The adult-agreement gate.** `adult_agreement_due` is recorded but nothing blocks the learner yet. It needs (a) published
   adult Terms and Privacy Notice documents, which do not exist until the legal pages are written and reviewed, (b) a
   sign-in refusal reason and an "agree to continue" screen reachable while blocked, (c) consent records of the new
   documents. The notices deliberately do not promise this step.
2. **A person looks at held accounts** (`accounts.age_up.held`): decide what a paused or pending teen who turns 18 becomes.
3. **Learner's own plan after 18.** Checkout for an adult already works; check that the trial rule (first subscription only)
   treats a Guardian-paid history correctly (`trialEligible` counts subscriptions the learner paid for).
4. **Guardian Center** should stop listing a closed link and say why; check `guardianLink` readers.

## Applying it

Apply `db/apply/S2.sql` in the Supabase SQL Editor **before** merging the code (the daily job calls the new functions), then
run `db/verify.sql`: the first row must end with `S2 18th-birthday switch is in place`.

## Counsel items

- Does ending the Guardian's role at 18 need any follow-up about the data collected under their consent?
- Is a plan the Guardian paid for fine to run to the end of the period without the learner's own consent?
- Are the warning emails enough notice, and is 30 and 7 days right?
