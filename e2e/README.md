# Gate 1: journeys, live smoke and the manual checklist

| Suite | Where it runs | What it uses |
| --- | --- | --- |
| `npm test` (unit + Gate 1 route × role) | every push (CI) | in-memory database, Clerk mocked |
| `npm run test:db` | every push (CI) | real Postgres |
| `npm run test:integration` (Gate 1 route × role again, bypass attempts) | every push (CI) | real Postgres behind PostgREST (Supabase's Data API engine); Clerk mocked |
| Journeys (`playwright.journeys.config.ts`) | Actions tab → **Journeys (Clerk development instance)** | local build, throwaway database, **Clerk development instance**, test users created and deleted per run |
| Live smoke (`playwright.smoke.config.ts`) | Actions tab → **Live smoke (production)** | the production site, Supabase and Clerk, **two test learners only** |

## GitHub secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**. Paste each value
there, never in chat or in code.

### Journeys (Clerk development instance)

| Secret | Where the value comes from |
| --- | --- |
| `CLERK_DEV_SECRET_KEY` | Clerk Dashboard → your ASCENTRA application → switch the instance picker (top) to **Development** → **Configure → API keys** → Secret key (`sk_test_…`) |
| `CLERK_DEV_PUBLISHABLE_KEY` | same page → Publishable key (`pk_test_…`) |

The development instance needs the same sign-in settings as production: **Email address** and
**Password** on, **Multi-factor → Authenticator application** on.

### Live smoke (production)

| Secret | Where the value comes from |
| --- | --- |
| `SMOKE_CLERK_SECRET_KEY` | Clerk Dashboard → **Production** instance → **Configure → API keys** → Secret key (`sk_live_…`); the same value as Vercel's `CLERK_SECRET_KEY` |
| `SMOKE_CLERK_PUBLISHABLE_KEY` | same page → Publishable key (`pk_live_…`); the same as Vercel's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `SMOKE_SUPABASE_URL` | Supabase → your project → **Project Settings → Data API** → Project URL; the same as Vercel's `SUPABASE_URL` |
| `SMOKE_SUPABASE_ANON_KEY` | Supabase → **Project Settings → API Keys** → `anon` `public` key (the public one; used to prove it can read nothing) |
| `SMOKE_SUPABASE_SERVICE_ROLE_KEY` | same page → `service_role` secret; the same as Vercel's `SUPABASE_SERVICE_ROLE_KEY` |
| `SMOKE_CRON_SECRET` | the same value as Vercel's `CRON_SECRET` (Vercel → project → **Settings → Environment Variables**). If Vercel shows it as sensitive and won't reveal it, generate a new one (`openssl rand -hex 32`), set it in Vercel (Production and Preview) **and** here, then redeploy |
| `SMOKE_OWNER_EMAIL` | the Owner's email, the same as Vercel's `OWNER_EMAIL`; used only as a guard |

## What the live smoke does, and doesn't

- Test users only: `ascentra-smoke-learner-a@…` and `ascentra-smoke-learner-b@…`, first name **TEST**,
  public metadata `ascentra_test: true`, fresh password and authenticator secret every run.
- Production can't create learners (sign-up is closed; invites are for admin roles), so the suite's
  setup writes the two test learner rows itself with the service role key (`e2e/smoke/fixtures.ts`).
  It refuses any row that isn't a `ascentra-smoke-` learner, and anything with the Owner's email.
- Never signs in as, changes, or flags the Owner, and checks that at the end.
- Cleans up: the test learners' devices are revoked, their sessions, signals, flags, steps and appeals
  deleted, their Clerk sessions revoked and their accounts disabled. Audit events stay (append-only),
  marked by the **TEST ASCENTRA smoke** name and `smoke-<run id>` request ids.
- Ends by running the audit-chain verification (`/api/cron/audit-verify`) and failing if it isn't intact.
