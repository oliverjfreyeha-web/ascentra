import { withAccount } from "@/lib/auth";

export const GET = withAccount(async (_req, _ctx, account) =>
  Response.json({ account }, { headers: { "Cache-Control": "no-store" } }),
);
