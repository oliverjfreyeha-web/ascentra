import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ATTORNEY, NO_ATTORNEY, clean, isUuid, refused, type Result } from "./common";
import { findIncomeClaims } from "./income";
import { TYPE_LABEL, type ItemType } from "@/lib/activities/types";

/**
 * C1: the list of learning boosters the Owner picks from in each module's recipe. Each booster is carried by activity
 * items of the types listed, with the same source, citation and review rules as any other item. The Owner adds, edits,
 * and turns boosters on or off (a booster in use is turned off, never deleted). Every change is audited.
 */
const TYPES = Object.keys(TYPE_LABEL) as ItemType[];
type Row = { id: string; key: string; name: string; description: string; item_types: string[]; active: boolean; sort_order: number };

export async function listBoosters() {
  const db = getDb();
  const rows = ((await db.from("booster_types").select("id, key, name, description, item_types, active, sort_order").order("sort_order", { ascending: true })).data ?? []) as Row[];
  const used = rows.length ? ((await db.from("activity_items").select("booster_key").in("booster_key", rows.map((b) => b.key))).data ?? []) as { booster_key: string }[] : [];
  return {
    boosters: rows.map((b) => ({ id: b.id, key: b.key, name: b.name, description: b.description, itemTypes: b.item_types, active: b.active, inUse: used.filter((u) => u.booster_key === b.key).length })),
    types: TYPES.map((t) => ({ type: t, label: TYPE_LABEL[t] })),
  };
}

function checked(body: Record<string, unknown>, before?: Row): { name: string; description: string; item_types: string[] } | { problem: string } {
  const name = body.name === undefined && before ? before.name : clean(body.name, 80);
  const description = body.description === undefined && before ? before.description : clean(body.description, 300);
  const types = body.itemTypes === undefined && before ? before.item_types : Array.isArray(body.itemTypes) ? [...new Set(body.itemTypes.filter((t): t is string => typeof t === "string"))] : [];
  if (name.length < 3) return { problem: "A booster needs a name (3 characters or more)." };
  if (!types.length || types.length > 4 || types.some((t) => !(TYPES as string[]).includes(t))) return { problem: "Choose 1 to 4 kinds of practice item that carry this booster." };
  if (ATTORNEY.test(`${name} ${description}`)) return { problem: NO_ATTORNEY };
  const claim = findIncomeClaims(`${name} \n ${description}`)[0];
  if (claim) return { problem: `This reads as ${claim.claim}: "${claim.text}". Reword it.` };
  return { name, description, item_types: types };
}

/** Body: { name, description, itemTypes }. */
export async function addBooster(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.boosters";
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner edits the list of learning boosters.", A);
  const c = checked(body);
  if ("problem" in c) return refused(400, c.problem, A);
  const db = getDb();
  const base = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "booster";
  const existing = ((await db.from("booster_types").select("key, sort_order")).data ?? []) as { key: string; sort_order: number }[];
  let key = base;
  for (let n = 2; existing.some((e) => e.key === key); n++) key = `${base}-${n}`;
  const { data, error } = await db.from("booster_types").insert({ key, ...c, sort_order: Math.max(0, ...existing.map((e) => e.sort_order)) + 1 }).select("id").single();
  if (error) throw new Error(`booster add failed: ${error.message}`);
  const target = { type: "booster", id: (data as { id: string }).id, label: c.name };
  return { ok: true, status: 201, body: { id: target.id, key }, event: { action: A, result: "Completed", target, previous: "not on the list", next: `${c.name} (${c.item_types.join(", ")})`, context: `Added the learning booster "${c.name}".` } };
}

/** Body: any of { name, description, itemTypes, active }. */
export async function editBooster(actor: Account, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.boosters";
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner edits the list of learning boosters.", A);
  if (!isUuid(id)) return refused(404, "No such booster.", A);
  const db = getDb();
  const before = (await db.from("booster_types").select("id, key, name, description, item_types, active, sort_order").eq("id", id).maybeSingle()).data as Row | null;
  if (!before) return refused(404, "No such booster.", A);
  const target = { type: "booster", id, label: before.name };
  const c = checked(body, before);
  if ("problem" in c) return refused(400, c.problem, A, target);
  const active = typeof body.active === "boolean" ? body.active : before.active;
  const { error } = await db.from("booster_types").update({ ...c, active }).eq("id", id);
  if (error) throw new Error(`booster edit failed: ${error.message}`);
  const show = (r: { name: string; item_types: string[]; active: boolean }) => `${r.name} (${r.item_types.join(", ")})${r.active ? "" : ", off"}`;
  return {
    ok: true, body: { id, active },
    event: { action: A, result: "Completed", target, previous: show(before), next: show({ ...c, active }), context: `Edited the learning booster "${c.name}"${active !== before.active ? (active ? "; turned on" : "; turned off (items already using it keep it)") : ""}.` },
  };
}
