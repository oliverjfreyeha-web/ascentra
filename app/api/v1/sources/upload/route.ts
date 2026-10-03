import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addDocument } from "@/lib/sources/library";

/** Upload a document (multipart: file, title?, licenseClass, licenseName?). Stored privately; starts as proposed. */
export const POST = withCap("sources.library.add", async (req, _ctx, account, x) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    await x.audit({ action: "sources.library.add", context: "Refused: the upload wasn't a form with a file.", result: "Blocked" });
    return refuse(400, "Send the document as a form upload.");
  }
  const r = await addDocument(account, form, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
}, { rawBody: true });
