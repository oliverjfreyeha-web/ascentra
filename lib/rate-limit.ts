/**
 * Fixed-window rate limiter held in memory. Each server instance counts separately,
 * so on a platform that runs several instances the effective limit is per instance.
 */
export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      let w = windows.get(key);
      if (!w || w.resetAt <= now) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
          // Still full of live windows: drop the oldest entry rather than grow without bound.
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!);
        }
        w = { count: 0, resetAt: now + windowMs };
        windows.set(key, w);
      }
      w.count++;
      if (w.count > limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
      return { ok: true, remaining: limit - w.count };
    },
  };
}

/** The caller's IP as reported by the hosting proxy (Vercel sets both headers). */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
