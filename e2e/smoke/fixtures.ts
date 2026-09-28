/**
 * Test accounts for the live smoke suite, and their cleanup.
 *
 * The live site has no path that creates a learner (sign-up is closed and invites are for admin roles),
 * so this harness writes the test learners' rows itself, with the service role key, exactly as the
 * webhook would for a synced user. It is fenced in:
 *   - it only ever touches accounts whose email starts with SMOKE_PREFIX and whose role is learner;
 *   - it refuses outright if any email matches OWNER_EMAIL or any row it would touch is the Owner;
 *   - audit_events is never written or deleted here (the app writes it; it is append-only).
 * Cleanup removes what the run created (devices are revoked, sessions and signals deleted, accounts
 * disabled). Audit events stay; they are marked by the TEST display name and the smoke request ids.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SMOKE_PREFIX = "ascentra-smoke-";

export function serviceDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed for the smoke fixtures.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function guard(email: string) {
  const owner = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!owner) throw new Error("OWNER_EMAIL is needed so the smoke suite can prove it never touches the Owner.");
  if (email.toLowerCase() === owner) throw new Error("Refusing: that is the Owner's email.");
  if (!email.startsWith(SMOKE_PREFIX)) throw new Error(`Refusing: ${email} isn't a smoke test account.`);
}

/** Creates or re-enables the learner account row for a Clerk test user. Returns the account id. */
export async function upsertTestLearner(db: SupabaseClient, u: { id: string; email: string; label: string }): Promise<string> {
  guard(u.email);
  const { data: existing, error: readErr } = await db.from("accounts").select("id, role, email").eq("clerk_user_id", u.id).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const fields = {
    email: u.email, email_verified: true, password_enabled: true, two_factor_enabled: true, status: "active",
    clerk_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  let id: string;
  if (existing) {
    if (existing.role !== "learner" || !String(existing.email).startsWith(SMOKE_PREFIX)) throw new Error("Refusing: existing row isn't a smoke learner.");
    const { error } = await db.from("accounts").update(fields).eq("id", existing.id).eq("role", "learner");
    if (error) throw new Error(error.message);
    id = existing.id;
  } else {
    const { data, error } = await db.from("accounts").insert({ clerk_user_id: u.id, role: "learner", ...fields }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    id = data.id;
  }
  const { error } = await db.from("profiles").upsert({ account_id: id, display_name: `TEST ${u.label}`, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return id;
}

async function smokeAccountIds(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("accounts").select("id, email, role").like("email", `${SMOKE_PREFIX}%`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; email: string; role: string }[];
  for (const r of rows) {
    guard(r.email);
    if (r.role !== "learner") throw new Error(`Refusing: ${r.email} isn't a learner.`);
  }
  return rows.map((r) => r.id);
}

/** Removes everything the smoke accounts left behind except audit events; optionally disables them. */
export async function cleanUp(db: SupabaseClient, { disable }: { disable: boolean }) {
  const ids = await smokeAccountIds(db);
  if (!ids.length) return { accounts: 0 };
  for (const table of ["appeals", "enforcement_steps", "sharing_flags", "sharing_signals", "session_events"]) {
    const { error } = await db.from(table).delete().in("account_id", ids);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  // Devices referenced by audit events stay (revoked); the rest are deleted.
  const now = new Date().toISOString();
  const { error: revErr } = await db.from("trusted_devices").update({ trust_state: "revoked", revoked_at: now, revoked_reason: "removed" })
    .in("account_id", ids).eq("trust_state", "trusted");
  if (revErr) throw new Error(revErr.message);
  const { data: devices } = await db.from("trusted_devices").select("id").in("account_id", ids);
  for (const d of (devices ?? []) as { id: string }[]) {
    const { count } = await db.from("audit_events").select("id", { count: "exact", head: true }).eq("device_id", d.id);
    if (!count) await db.from("trusted_devices").delete().eq("id", d.id);
  }
  if (disable) {
    const { error } = await db.from("accounts").update({ status: "disabled", updated_at: now }).in("id", ids).eq("role", "learner");
    if (error) throw new Error(error.message);
  }
  return { accounts: ids.length };
}

/** The Owner's row, and any safeguard step or flag on the Owner since `since`: the run must add none. */
export async function ownerState(db: SupabaseClient, since: string) {
  const { data: owner, error } = await db.from("accounts").select("id, role, status, two_factor_enabled").eq("role", "owner").single();
  if (error || !owner) throw new Error("No Owner row found.");
  const newer = async (table: string, col: string) =>
    (await db.from(table).select("id", { count: "exact", head: true }).eq("account_id", owner.id).gte(col, since)).count ?? 0;
  return { owner, stepsSince: await newer("enforcement_steps", "created_at"), flagsSince: await newer("sharing_flags", "raised_at") };
}
