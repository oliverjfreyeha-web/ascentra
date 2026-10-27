<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Running this repo in the Base44 sandbox

```bash
docker compose -f docker-compose.base44.yml up -d --build   # the app is then on host port 3000
```

`entry` (host port 3000, nginx) → `web` (Next's dev server on 3001) → `db`, `db-setup`, `rest`,
`gateway`. Only port 3000 is published; 8000 exposes the Data API's `/rest/v1` for debugging.

- **Supabase is emulated locally; Clerk is not.** `db` is Postgres 17 + pgvector, `db-setup`
  (`scripts/base44/db-setup.sh`) applies `db/test/supabase-shim.sql` and every migration, `rest` is
  PostgREST, and `gateway` serves it under `/rest/v1` — the shape `lib/db` expects, the same one
  `tests/integration/stack.ts` builds. Check the schema with the app's own query:
  `docker compose -f docker-compose.base44.yml run --rm --entrypoint sh db-setup -c 'psql postgresql://postgres:postgres@db:5432/postgres -f /repo/db/verify.sql'`
- **No GoTrue, so Supabase's Auth API is absent.** `lib/health.ts` probes Supabase through
  `auth.admin.listUsers()` (`/auth/v1`), which nothing here answers, so the site's service status
  shows Supabase "Disconnected" while the Data API that carries all data works. This is deliberate:
  the status is meant to be truthful, so don't stub `/auth/v1` to make it green.
- **The `entry` proxy restores the https signal.** The sandbox's own proxy reaches the container over
  plain HTTP and forwards no `X-Forwarded-Proto`, so the app would build absolute URLs as http. A
  Clerk *development* instance hands the browser off to its FAPI handshake
  (`__clerk_hs_reason=dev-browser-missing`) with a `redirect_url` built from that scheme, and an http
  redirect inside the https preview never completes — that is why `entry` sets the header before
  `web`. Check it with a browser-shaped request (an ordinary curl gets no handshake at all):
  ```bash
  curl -sD -o /dev/null -H "Accept: text/html" -H "Sec-Fetch-Mode: navigate" \
    "https://3000-$BASE44_PUBLIC_HOST_SUFFIX/" | grep -i location
  ```
  With a real `pk_test_` key that Location's `redirect_url` must be https. Do NOT reach for Next's
  `experimental.trustHostHeader` instead: with it the dev server proxies requests to itself and every
  page dies with "Failed to proxy http://0.0.0.0:3001/". `entry` also re-resolves `web` through
  Docker's DNS (127.0.0.11), because replacing the app container gives it a new address.
- **Credentials.** `.env.base44-defaults` (committed) holds format-valid placeholders and the local
  PostgREST key; `/run/base44/app.env` is listed after it, so values stored in the dashboard win.
  Real Clerk keys are needed to sign in, and `OWNER_EMAIL` must be the Clerk user that should become
  the Owner. `lib/env.ts` refuses to boot without them, which is why the placeholders exist. The Clerk
  placeholders are deliberately *live*-shaped (`sk_live_`/`pk_live_`): a `pk_test_` placeholder starts
  the dev-instance handshake above toward a host only a real instance can answer, and the preview
  would follow that redirect instead of rendering the app.
  While the keys are placeholders, page loads and hydration work (the home page and its service
  status render), but anything Clerk-backed stays unloaded: the browser logs Clerk's "unable to
  attribute this request to an instance" and `/sign-in` did not render under client-side navigation
  in the verification browser even though `GET /sign-in` answers 200 with its heading. Real keys are
  what resolve that — don't go chasing it as an app bug.
- **Signing in also needs the webhook.** Accounts come only from signature-verified Clerk webhooks
  (`app/api/webhooks/clerk`). Point a Clerk webhook at
  `https://3000-$BASE44_PUBLIC_HOST_SUFFIX/api/webhooks/clerk` (the sandbox host changes when the
  environment is recreated), otherwise every signed-in visitor sees "not open yet".
- `next.config.ts` allows `3000-<BASE44_PUBLIC_HOST_SUFFIX>` in `allowedDevOrigins` only while
  `BASE44_PREVIEW_MODE === "1"`; unset, the list is empty and Next behaves exactly as before.
- The first `up` runs `npm ci` and the first request compiles, so the web service's healthcheck has a
  long start period; edits hot-reload through the bind mount.
