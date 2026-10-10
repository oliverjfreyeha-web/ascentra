import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { createCourseFromFile } from "@/lib/courses/import";

/** I1: "Create Draft": checks the file again, then creates a new Draft version in one transaction. Body: { fileName, content }. Owner only. */
export const POST = withCap("courses.import", async (_req, _ctx, account, x) => {
  const r = await createCourseFromFile(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
