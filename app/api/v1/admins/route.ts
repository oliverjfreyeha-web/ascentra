import { withCap } from "@/lib/auth";
import { listAdmins } from "@/lib/admins";
import { ok } from "@/lib/http";

// Owner only: who holds an admin role, and which invites are open.
export const GET = withCap("admins.view", async () => ok(await listAdmins()));
