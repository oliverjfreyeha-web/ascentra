import { withCap } from "@/lib/auth";
import { guardianOverview } from "@/lib/guardians";
import { ok } from "@/lib/http";
import { allowanceOf, meterLine } from "@/lib/mentor-allowance";

// The Guardian Center: the Guardian's identity check, each linked teen and where they stand, and the teen documents.
// L5: for each teen whose plan the Guardian pays for, the Mentor allowance meter (only the Guardian changes it).
export const GET = withCap("guardian.controls", async (_req, _ctx, account) => {
  const o = await guardianOverview(account);
  const teens = [];
  for (const t of o.teens) {
    if (!t.subscription) {
      teens.push({ ...t, mentorAllowance: null });
      continue;
    }
    const a = await allowanceOf({ id: t.id, roleKey: "learner" });
    teens.push({
      ...t,
      mentorAllowance: {
        status: a.status, addonCents: a.addonCents, nextAddonCents: a.nextAddonCents, choices: a.choices, usableUsd: a.usableUsd,
        usedUsd: a.usedUsd, resetsAt: a.resetsAt, trial: a.trial, line: a.status === "none" ? "Mentor allowance: none" : meterLine(a),
      },
    });
  }
  return ok({ ...o, teens });
});
