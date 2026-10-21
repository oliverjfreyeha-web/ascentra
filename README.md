# ASCENTRA

Production build of ASCENTRA. The prototype in `reference/` (`ascentra.html`, `j5.py`, `j6.py`, `j8.py`) is
read-only and is the reference for names, rules and wording.

**Stage:** Foundations F5 of 7 · append-only audit store.

## Run

```bash
cp .env.example .env.local   # fill in all values; the server will not start without them
npm ci
npm run dev
```

## Rules this layout enforces

- **Environment:** `lib/env.ts` validates every required variable with Zod when the server starts
  (`instrumentation.ts`). Anything missing stops the server with a message naming the variable. No defaults.
- **Secrets never reach the build:** Turbopack writes the whole build environment into `.next/cache`.
  `npm run build` (`scripts/build.mjs`) runs `next build` with every secret removed; secrets are read
  only at request time. `npm run check:build-secrets` searches all of `.next`, cache included, for them.
- **Identity vs. permission:** Clerk proves who someone is. Postgres (`accounts`, `profiles`) holds what
  they may do, written only from signature-verified Clerk webhooks (`app/api/webhooks/clerk`).
- **Row-level security everywhere:** every table has RLS on and denies by default; `accounts` and
  `profiles` allow reading your own row only. `audit_events` and `consent_records` are insert-only,
  enforced by grants, policies and triggers, so not even the service role can change them.
- **Capabilities:** `lib/caps.ts` is the only permission map (from the prototype's ROLE_CAPS, NEVER_CAPS
  and ADMIN_ROLES). Every `/api/v1` route except `/health` is exported through `withCap()`, which checks
  the capability and course scope, answers 403 with a plain reason, and records the refusal. Owner-only
  capabilities can't be held by any other role. `tests/gate1/` checks every role against every capability.
- **Owner protections:** the Owner can't be demoted, suspended or deleted, by the API or in the database
  (triggers in `0005`). Admins are invited by the Owner only (single-use, 7-day, email-bound, revocable)
  and need a second factor; sensitive actions ask for it again (Clerk reverification).
- **Audit store:** `recordAudit()` in `lib/audit.ts` is the only writer of `audit_events` (fields as in
  the prototype's `audit()`, plus request and device ids). The table is insert-only, and a database
  trigger chains each row to the previous one by hash; `public.audit_verify_chain()` reports the first
  break (Owner button at `/admin/audit`, and a daily Vercel Cron). Actions that need a reason are refused
  without one (400), and every such request writes exactly one event. Owner and Super Admin can read,
  search and export the log; exports are recorded.
- **One way in:** `getAccount()` in `lib/auth` turns a request into an Account, or nothing. Every
  `/api/v1` route except `/health` is wrapped in `withAccount()`; a test finds every route and checks for 401.
- **Server-only data access:** `lib/db` holds the Supabase service-role client and imports `server-only`,
  so a Client Component that imports it fails the build. `scripts/check-bundle.mjs` searches the built
  client bundle for secret names, key shapes and the secret values.
- **The API is the only path to data:** ESLint forbids `app/**` (outside `app/api/**`) from importing
  `lib/db` or `@supabase/*`. Pages fetch `/api/v1/*`.
- **Truthful status:** `GET /api/v1/health` reports each service as Disconnected until a real call
  succeeds. Connected always carries the evidence (which call returned what).

## Layout

| Path | Purpose |
| --- | --- |
| `app/` | Pages (no data access) |
| `app/api/v1/` | The API; the only code that talks to the database |
| `lib/db/` | Server-only Supabase client |
| `lib/env.ts` | Environment schema |
| `lib/health.ts`, `lib/connection-status.ts` | Health probes and ConnectionStatus |
| `lib/auth/` | `getAccount()` and `withAccount()` |
| `lib/accounts.ts` | Clerk user → Account and Profile sync, Owner seeding |
| `lib/audit.ts` | The audit store: write, search, CSV export, chain verification |
| `lib/rate-limit.ts` | In-memory rate limiter used by `/health` |
| `proxy.ts` | Clerk session middleware (Next 16's renamed middleware) |
| `lib/caps.ts` | The capability map and `decide()` |
| `lib/admin-rules.ts`, `lib/admins.ts` | Admin invites and roles: rules, then database + Clerk |
| `app/admin/` | The Owner's admin page and the audit log (`/admin/audit`), API only |
| `app/api/cron/` | Vercel Cron jobs (`vercel.json`), authenticated with `CRON_SECRET` |
| `lib/devices.ts` | Empty until a later Foundations stage |
| `db/` | Migrations, the SQL Editor bundle, the verify query: see [db/README.md](db/README.md) |
| `tests/unit/` | Vitest unit tests |
| `tests/journeys/`, `tests/gate1/` | Empty until later stages |

## Scripts

`npm run typecheck` · `npm run lint` · `npm test` · `npm run build` · after a build: `npm run check:bundle`,
`npm run check:build-secrets` · once, to invite the Owner: `node --env-file=.env.local scripts/invite-owner.mjs`

Database: `npm run test:db` (needs `TEST_DATABASE_URL`) · `npm run db:bundle` · `npm run db:seed` (local only)
