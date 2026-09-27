import pkg from "@/package.json";
import { HEALTH_CACHE_SECONDS, getServiceStatuses } from "@/lib/health";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

export const HEALTH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const limiter = createRateLimiter(HEALTH_RATE_LIMIT);

// Public by design: the only /api/v1 route that does not require an Account.
export async function GET(req: Request) {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }
  const { services, cached } = await getServiceStatuses();
  return Response.json(
    { version: pkg.version, time: new Date().toISOString(), cached, cacheSeconds: HEALTH_CACHE_SECONDS, services },
    // Shared caches (the CDN) may reuse the answer for the same window; browsers always revalidate.
    { headers: { "Cache-Control": `public, max-age=0, s-maxage=${HEALTH_CACHE_SECONDS}` } },
  );
}
