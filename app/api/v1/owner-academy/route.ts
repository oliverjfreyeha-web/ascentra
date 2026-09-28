import { withCap } from "@/lib/auth";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { ok } from "@/lib/http";

// Owner only: the protected Owner Academy. Content arrives in a later stage; this is the gate.
export const GET = withCap("owner_academy.open", async () =>
  ok({ academy: { slug: OWNER_ACADEMY_SLUG, name: "Growth System Academy", protected: true } }),
);
