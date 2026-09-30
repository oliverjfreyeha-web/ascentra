import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// scripts/stripe-setup.ts refuses anything but a sandbox key, before it contacts Stripe.
const run = (key: string) =>
  spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/stripe-setup.ts"], {
    env: { ...process.env, STRIPE_SECRET_KEY: key }, encoding: "utf8", timeout: 60_000,
  });

describe("stripe-setup", () => {
  it.each(["sk_live_abc123", "rk_live_abc123"])("refuses a live key (%s…) and changes nothing", (key) => {
    const r = run(key);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/That is a LIVE key/);
  });
  it("refuses something that isn't a secret key", () => {
    const r = run("pk_test_abc123");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/doesn't look like a Stripe sandbox secret key/);
  });
});
