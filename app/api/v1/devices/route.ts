import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { ownSecurity } from "@/lib/security-view";

// Your own devices, recent sessions, safeguard step and appeals (/account).
export const GET = withCap("devices.manage", async (_req, _ctx, account, x) =>
  ok(await ownSecurity(account.id, account.roleKey, x.device.device?.id ?? null)),
{ device: "any", allowSuspended: true });
