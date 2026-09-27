# ASCENTRA

Production build of ASCENTRA. The prototype in `reference/` (`ascentra.html`, `j5.py`, `j6.py`, `j8.py`) is
read-only and is the reference for names, rules and wording.

**Stage:** Foundations F1 of 7 · project setup.

## Run

```bash
cp .env.example .env.local   # fill in all values; the server will not start without them
npm ci
npm run dev
```

## Rules this layout enforces

- **Environment:** `lib/env.ts` validates every required variable with Zod when the server starts
  (`instrumentation.ts`). Anything missing stops the server with a message naming the variable. No defaults.
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
| `lib/auth/`, `lib/caps.ts`, `lib/audit.ts`, `lib/devices.ts` | Empty until later Foundations stages |
| `db/migrations/` | SQL migrations (none yet) |
| `tests/unit/` | Vitest unit tests |
| `tests/journeys/`, `tests/gate1/` | Empty until later stages |

## Scripts

`npm run typecheck` · `npm run lint` · `npm test` · `npm run build` · `npm run check:bundle` (after a build)
