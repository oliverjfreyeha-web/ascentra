import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows the limit, refuses the next, and resets after the window", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => rl.check("a", 0).ok)).toEqual([true, true, true]);
    expect(rl.check("a", 500)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(rl.check("a", 1000).ok).toBe(true);
  });

  it("keeps at most maxKeys entries", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    rl.check("a", 0);
    rl.check("b", 0);
    rl.check("c", 0); // evicts "a"
    expect(rl.check("a", 0).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    const h = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientIp(h({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(h({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
