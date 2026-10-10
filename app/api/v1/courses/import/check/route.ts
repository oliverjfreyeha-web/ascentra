import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { checkCourseFile } from "@/lib/courses/import";

/** I1: "Check file": a dry run that writes nothing but the audit record. Body: { fileName, content }. Owner only. */
export const POST = withCap("courses.import", async (_req, _ctx, account, x) => {
  const r = await checkCourseFile(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
