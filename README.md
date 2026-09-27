# ASCENTRA

Production build of ASCENTRA. The prototype in `reference/` (`ascentra.html`, `j5.py`, `j6.py`, `j8.py`) is
read-only and is the reference for names, rules and wording.

**Stage:** Foundations F2 of 7 · sign-in with Clerk.

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
| `lib/audit.ts` | Audit stub (log only) until the audit store in F5 |
| `lib/rate-limit.ts` | In-memory rate limiter used by `/health` |
| `proxy.ts` | Clerk session middleware (Next 16's renamed middleware) |
| `lib/caps.ts`, `lib/devices.ts` | Empty until later Foundations stages |
| `db/migrations/` | SQL migrations, applied by hand in Supabase's SQL Editor |
| `tests/unit/` | Vitest unit tests |
| `tests/journeys/`, `tests/gate1/` | Empty until later stages |

## Scripts

`npm run typecheck` · `npm run lint` · `npm test` · `npm run build` · after a build: `npm run check:bundle`,
`npm run check:build-secrets` · once, to invite the Owner: `node --env-file=.env.local scripts/invite-owner.mjs`
