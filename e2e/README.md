# Gate 1: journeys, live smoke and the manual checklist

| Suite | Where it runs | What it uses |
| --- | --- | --- |
| `npm test` (unit + Gate 1 route × role) | every push (CI) | in-memory database, Clerk mocked |
| `npm run test:db` | every push (CI) | real Postgres |
| `npm run test:integration` (Gate 1 route × role again, bypass attempts) | every push (CI) | real Postgres behind PostgREST (Supabase's Data API engine); Clerk mocked |
| Journeys (`playwright.journeys.config.ts`) | Actions tab → **Journeys** | local build, throwaway database, the one Clerk instance; a TEST Owner and test users created and deleted per run |
| Live smoke (`playwright.smoke.config.ts`) | Actions tab → **Live smoke** | the live site, its Supabase and the one Clerk instance, **two test learners only** |

## One Clerk instance, and the real Owner

The live site, the journeys and the smoke all use the same Clerk instance (the development instance,
`pk_test_`/`sk_test_`), and the real Owner's user is in it. The key type is therefore not a guard.
What protects the Owner is `e2e/lib/clerk-users.ts`: every Clerk user the tests create, change, sign
out or delete must have a test email (`ascentra-e2e-…` or `ascentra-smoke-…`), must be marked
`ascentra_test: true`, and must not be the Owner by email **or** by Clerk user id (looked up live from
`OWNER_EMAIL`). Without `OWNER_EMAIL` both workflows refuse to start. The journeys' local app has its
own fresh database and a TEST Owner; it never sees the real Owner.

Side effect to expect: creating test users makes Clerk send `user.created` webhooks to the live site.
They create nothing there (no account, or a refused invite claim), but a refused claim is recorded in
the live audit log as Blocked, under the `ascentra-e2e-…` email.

## GitHub secrets (6)

Repository → **Settings → Secrets and variables → Actions → New repository secret**. Paste each value
there, never in chat or in code. The names match the Vercel variables, and the values are the same.

| Secret | Used by | Where the value comes from |
| --- | --- | --- |
| `CLERK_SECRET_KEY` | both | Clerk Dashboard → ASCENTRA → **Configure → API keys** → Secret key (`sk_test_…`); the same as Vercel's `CLERK_SECRET_KEY` |
| `CLERK_PUBLISHABLE_KEY` | both | same page → Publishable key (`pk_test_…`); the same as Vercel's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `OWNER_EMAIL` | both | the real Owner's email; the same as Vercel's `OWNER_EMAIL`. Used only to keep away from the Owner |
| `SUPABASE_URL` | smoke | Supabase → your project → **Project Settings → Data API** → Project URL; the same as Vercel's `SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | smoke | Supabase → **Project Settings → API Keys** → the `anon` `public` key (public by design; used to prove it can read nothing) |
| `SUPABASE_SERVICE_ROLE_KEY` | smoke | same page → the `service_role` secret; the same as Vercel's `SUPABASE_SERVICE_ROLE_KEY` |

The journeys need only the first three. `CRON_SECRET` isn't needed: the smoke verifies the audit
chain with the same database function the daily job runs.

## What the live smoke does, and doesn't

- Test users only: `ascentra-smoke-learner-a+clerk_test@example.com` and `…-learner-b…`, first name **TEST**,
  public metadata `ascentra_test: true`, fresh password and authenticator secret every run.
- The live site can't create learners (sign-up is closed; invites are for admin roles), so the suite's
  setup writes the two test learner rows itself with the service role key (`e2e/smoke/fixtures.ts`).
  It refuses any row that isn't a `ascentra-smoke-` learner, and anything with the Owner's email.
- Never signs in as, changes, or flags the Owner, and checks that at the end.
- Cleans up: the test learners' devices are revoked, their sessions, signals, flags, steps and appeals
  deleted, their Clerk sessions revoked and their accounts disabled. Audit events stay (append-only),
  marked by the **TEST ASCENTRA smoke** name and `smoke-<run id>` request ids.
- Ends by running the audit-chain verification (`public.audit_verify_chain`, the same check as the daily
  job and the Owner's button) and fails if it isn't intact.
