import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => () => undefined }));
const { config } = await import("@/proxy");

const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("proxy (Clerk session middleware) matcher", () => {
  it.each(["/", "/sign-in", "/not-open", "/account", "/api/v1/me", "/api/v1/anything/else"])(
    "runs on %s, so auth() can read the session there",
    (url) => expect(runs(url)).toBe(true),
  );

  it.each(["/api/v1/health", "/api/webhooks/clerk", "/api/cron/audit-verify", "/_next/static/chunks/app.js", "/favicon.ico"])(
    "skips %s",
    (url) => expect(runs(url)).toBe(false),
  );
});
