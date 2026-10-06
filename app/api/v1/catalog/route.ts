import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listCatalog } from "@/lib/catalog";

// L6: the topic catalog: every learnable topic from the Academy Blueprint, and every course, with its state and queue job.
export const GET = withCap("catalog.view", async (_req, _ctx, account) => ok(await listCatalog(account)));
