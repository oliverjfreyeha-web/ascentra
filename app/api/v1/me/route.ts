import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";

export const GET = withCap("self.view", async (_req, _ctx, account) =>
  ok({
    account: {
      id: account.id,
      email: account.email,
      role: account.role,
      roleKey: account.roleKey,
      displayName: account.displayName,
      assignedCourses: account.assignedCourses,
    },
  }),
);
