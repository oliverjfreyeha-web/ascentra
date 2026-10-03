import "server-only";
import { z } from "zod";

/**
 * Email through Resend (https://resend.com/docs/api-reference/emails/send-email). Optional, like billing: when
 * RESEND_API_KEY or NOTICE_FROM_EMAIL is missing, notices are recorded as "skipped" and the site keeps working.
 * No defaults: both values come from the host's environment.
 */
export const emailEnvSchema = z.object({
  RESEND_API_KEY: z.string().startsWith("re_", "must be a Resend API key (re_…)"),
  // "ASCENTRA <notices@your-domain>" or a bare address, on a domain verified in Resend.
  NOTICE_FROM_EMAIL: z.string().regex(/^([^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/, "must be an email address, optionally with a name"),
});
export type EmailEnv = z.infer<typeof emailEnvSchema>;
export const EMAIL_ENV_VARS = Object.keys(emailEnvSchema.shape) as (keyof EmailEnv)[];

export function readEmailEnv(source: Record<string, string | undefined> = process.env): { ok: true; env: EmailEnv } | { ok: false; problems: string[] } {
  const picked = Object.fromEntries(EMAIL_ENV_VARS.map((k) => [k, source[k]?.trim() || undefined]));
  const r = emailEnvSchema.safeParse(picked);
  if (r.success) return { ok: true, env: r.data };
  return { ok: false, problems: r.error.issues.map((i) => `${String(i.path[0])} is ${picked[String(i.path[0])] === undefined ? "missing" : `invalid (${i.message})`}`) };
}

export type Email = { to: string; subject: string; text: string; idempotencyKey: string };

/** Sends one email. Resend's Idempotency-Key makes a repeated send of the same notice a no-op on their side. */
export async function sendEmail(env: EmailEnv, e: Email): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": e.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({ from: env.NOTICE_FROM_EMAIL, to: [e.to], subject: e.subject, text: e.text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !body.id) return { ok: false, error: `Resend ${res.status}: ${body.name ?? ""} ${body.message ?? ""}`.trim() };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: `Resend unreachable: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
