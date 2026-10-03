import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import type { AuditInput } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { AiUnavailable, embed, structured } from "@/lib/ai";
import { contentWords, overlap, quoteIsIn } from "./text";

/**
 * L1: claims, conflicts and authority decisions.
 *   - Claims are extracted from approved sources (Claude Haiku 4.5, one passage at a time). Each keeps its citation:
 *     the source, the passage, and a short quote that must appear word for word in the passage, or it is dropped.
 *     A claim added by hand without a source is marked "no source".
 *   - When two approved sources disagree, a SourceConflict is opened (by the model's check or by a Reviewer) and
 *     shown in the Reviewer queue. A Reviewer (or the Owner) records an AuthorityDecision: which source is followed,
 *     and why. Decisions are versioned and can't be edited. Nothing is ever called attorney-approved.
 */
type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type ClaimResult<T = Record<string, unknown>> =
  | { ok: true; status?: number; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
const refused = (status: number, reason: string, action: string, target: Event["target"] = null): ClaimResult<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTORNEY = /attorney[- ]?approved|lawyer[- ]?approved|legally approved/i;
const NO_ATTORNEY = "ASCENTRA never calls anything attorney-approved. Reword it.";
const MAX_PASSAGES = 12;
const MAX_CANDIDATES = 5;

type Claim = { id: string; source_id: string | null; chunk_id: string | null; claim: string; cited_text: string | null; citation_status: string; extracted_by: string; state: string; created_at: string };
type Source = { id: string; title: string; status: string; license_class: string; url: string | null };

async function approvedSource(id: unknown): Promise<Source | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const s = (await getDb().from("sources").select("id, title, status, license_class, url, academy_id").eq("id", id).maybeSingle()).data as (Source & { academy_id: string | null }) | null;
  return s && s.academy_id == null && s.status === "approved" ? s : null;
}

const EXTRACT_SYSTEM = [
  "You extract factual claims from a passage of a source document for a learning platform's source library.",
  "Rules:",
  "- Return at most 5 claims, each a single self-contained sentence stating something the passage asserts.",
  "- For each claim, quote the exact words from the passage that support it (8 to 300 characters, copied verbatim).",
  "- Only claims the passage itself makes. No outside knowledge, no opinions about the passage.",
  "- If the passage makes no clear factual claims, return an empty list.",
].join("\n");
const ExtractSchema = z.object({ claims: z.array(z.object({ claim: z.string(), quote: z.string() })) });

const CONFLICT_SYSTEM = [
  "You compare pairs of claims taken from two different sources.",
  "For each pair, decide whether the two claims contradict each other: both cannot be followed at once.",
  "Claims that differ in scope or detail but can both be true are not a contradiction.",
  "Give a one-sentence reason for each pair.",
].join("\n");
const ConflictSchema = z.object({ results: z.array(z.object({ pair: z.number().int(), contradicts: z.boolean(), reason: z.string() })) });

/** Extracts claims from an approved source, then checks them against other approved sources for conflicts. */
export async function extractClaims(actor: Account, sourceId: string, requestId?: string): Promise<ClaimResult> {
  const A = "sources.claims.extract";
  const source = await approvedSource(sourceId);
  if (!source) return refused(404, "Claims are taken only from an approved source.", A, { type: "source", id: sourceId });
  const target = { type: "source", id: source.id, label: source.title };
  const db = getDb();
  const { data: chunks, error } = await db.from("source_chunks").select("id, position, content").eq("source_id", source.id).order("position", { ascending: true }).limit(MAX_PASSAGES);
  if (error) throw new Error(`chunk lookup failed: ${error.message}`);
  const existing = new Set((((await db.from("source_claims").select("claim").eq("source_id", source.id)).data ?? []) as { claim: string }[]).map((c) => c.claim.toLowerCase()));
  const added: Claim[] = [];
  let dropped = 0;
  try {
    for (const ch of (chunks ?? []) as { id: string; position: number; content: string }[]) {
      const out = await structured("claims.extract", {
        system: EXTRACT_SYSTEM, user: `Source: ${source.title}\n\nPassage:\n${ch.content}`, schema: ExtractSchema, maxTokens: 2048,
        accountId: actor.id, requestId,
      });
      for (const c of out.claims.slice(0, 5)) {
        const claim = c.claim.replace(/\s+/g, " ").trim().slice(0, 500);
        // Every claim keeps its citation: the quote must be in the passage word for word, or the claim is dropped.
        if (!claim || !quoteIsIn(c.quote, ch.content) || ATTORNEY.test(claim) || existing.has(claim.toLowerCase())) { dropped++; continue; }
        const { data, error: insErr } = await db.from("source_claims").insert({
          source_id: source.id, chunk_id: ch.id, claim, cited_text: c.quote.replace(/\s+/g, " ").trim().slice(0, 400),
          citation_status: "cited", extracted_by: "ai", state: "proposed", added_by_account_id: actor.id,
        }).select("*").single();
        if (insErr) throw new Error(`claim insert failed: ${insErr.message}`);
        existing.add(claim.toLowerCase());
        added.push(data as Claim);
      }
    }
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    if (!added.length) return refused(err.code === "ai_off" ? 503 : err.code === "cap_reached" ? 429 : 502, err.message, A, target);
  }
  const conflicts = added.length ? await detectConflicts(actor, added, requestId) : 0;
  return {
    ok: true, body: { claims: added.length, dropped, conflicts },
    event: {
      action: A, result: "Completed", target, previous: `${existing.size - added.length} claim(s)`, next: `${existing.size} claim(s)`,
      context: `Extracted ${added.length} cited claim(s) from "${source.title}" (Claude Haiku 4.5)${dropped ? `; ${dropped} dropped because their quote wasn't in the passage or they repeated an existing claim` : ""}. ${conflicts} conflict(s) with other approved sources opened for review.`,
    },
  };
}

/** Compares new claims with similar claims of other approved sources; a contradiction opens a SourceConflict. */
async function detectConflicts(actor: Account, fresh: Claim[], requestId?: string): Promise<number> {
  const db = getDb();
  const { data: approved } = await db.from("sources").select("id").is("academy_id", null).eq("status", "approved");
  const approvedIds = new Set(((approved ?? []) as { id: string }[]).map((s) => s.id));
  const { data: all } = await db.from("source_claims").select("*").eq("citation_status", "cited").order("created_at", { ascending: false }).limit(400);
  const pool = ((all ?? []) as Claim[]).filter((c) => c.source_id && approvedIds.has(c.source_id));
  const pairs: [Claim, Claim][] = [];
  for (const c of fresh) {
    const words = contentWords(c.claim);
    const near = pool.filter((o) => o.source_id !== c.source_id && o.id !== c.id)
      .map((o) => ({ o, score: overlap(words, contentWords(o.claim)) })).filter((x) => x.score >= 0.25)
      .sort((x, y) => y.score - x.score).slice(0, MAX_CANDIDATES);
    for (const { o } of near) pairs.push([c, o]);
  }
  if (!pairs.length) return 0;
  let opened = 0;
  for (let i = 0; i < pairs.length; i += 10) {
    const batch = pairs.slice(i, i + 10);
    let out: z.infer<typeof ConflictSchema>;
    try {
      out = await structured("conflicts.detect", {
        system: CONFLICT_SYSTEM, schema: ConflictSchema, maxTokens: 2048, accountId: actor.id, requestId,
        user: batch.map(([a, b], k) => `Pair ${k}:\nA: ${a.claim}\nB: ${b.claim}`).join("\n\n"),
      });
    } catch (err) {
      if (err instanceof AiUnavailable) break;
      throw err;
    }
    for (const r of out.results) {
      const pair = batch[r.pair];
      if (!pair || !r.contradicts) continue;
      const { error } = await db.from("source_conflicts").insert({
        claim_a_id: pair[0].id, claim_b_id: pair[1].id, reasons: [r.reason.slice(0, 500)], status: "open", detected_by: "ai", created_by_account_id: actor.id,
      });
      if (!error) opened++;
      else if (error.code !== "23505") throw new Error(`conflict insert failed: ${error.message}`);
    }
  }
  return opened;
}

/** A claim added by hand. With a source (approved) it is cited; without one it is marked "no source". */
export async function addClaim(actor: Account, body: Record<string, unknown>): Promise<ClaimResult> {
  const A = "sources.claims.add";
  const claim = typeof body.claim === "string" ? body.claim.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (claim.length < 5) return refused(400, "Write the claim (one sentence).", A);
  if (ATTORNEY.test(claim)) return refused(400, NO_ATTORNEY, A);
  let source: Source | null = null;
  const quote = typeof body.citedText === "string" ? body.citedText.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  if (body.sourceId != null && body.sourceId !== "") {
    source = await approvedSource(body.sourceId);
    if (!source) return refused(404, "A claim cites an approved source, or none (it is then marked as having no source).", A);
    if (!quote) return refused(400, "Quote the words in the source that support the claim.", A);
  }
  const { data, error } = await getDb().from("source_claims").insert({
    source_id: source?.id ?? null, claim, cited_text: source ? quote : null, citation_status: source ? "cited" : "no_source",
    extracted_by: "person", state: "proposed", added_by_account_id: actor.id,
  }).select("id").single();
  if (error) throw new Error(`claim insert failed: ${error.message}`);
  const id = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: { id, citation: source ? "cited" : "no_source" },
    event: {
      action: A, result: "Completed", target: { type: "claim", id, label: claim.slice(0, 120) }, previous: "none",
      next: source ? `cited: "${source.title}"` : "no source",
      context: source ? `Added a claim citing "${source.title}".` : "Added a claim with no source; it is marked as such.",
    },
  };
}

/** A Reviewer opens a conflict between two claims of different approved sources. Body: { claimAId, claimBId, why }. */
export async function openConflict(actor: Account, body: Record<string, unknown>): Promise<ClaimResult> {
  const A = "sources.conflicts.open";
  const [a, b] = [body.claimAId, body.claimBId].map((v) => (typeof v === "string" && UUID.test(v) ? v : null));
  const why = typeof body.why === "string" ? body.why.trim().slice(0, 500) : "";
  if (!a || !b || a === b) return refused(400, "Choose two different claims.", A);
  if (why.length < 5) return refused(400, "Say how the two claims disagree.", A);
  const db = getDb();
  const claims = ((await db.from("source_claims").select("*").in("id", [a, b])).data ?? []) as Claim[];
  const ca = claims.find((c) => c.id === a);
  const cb = claims.find((c) => c.id === b);
  if (!ca?.source_id || !cb?.source_id || ca.source_id === cb.source_id || !(await approvedSource(ca.source_id)) || !(await approvedSource(cb.source_id))) {
    return refused(400, "A conflict is between claims of two different approved sources.", A);
  }
  const { data, error } = await db.from("source_conflicts").insert({
    claim_a_id: a, claim_b_id: b, reasons: [why], status: "open", detected_by: "person", created_by_account_id: actor.id,
  }).select("id").single();
  if (error?.code === "23505") return refused(409, "These two claims already have an open conflict.", A);
  if (error) throw new Error(`conflict insert failed: ${error.message}`);
  const id = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: { id },
    event: { action: A, result: "Completed", target: { type: "conflict", id }, previous: "none", next: "open", context: `Opened a source conflict: "${ca.claim}" vs "${cb.claim}". ${why}` },
  };
}

/**
 * The Reviewer's AuthorityDecision: which claim (and so which source) is followed, and why. Body:
 * { chosenClaimId, decision } plus the request's reason, recorded as the rationale. A new version each time.
 */
export async function decideConflict(actor: Account, conflictId: string, body: Record<string, unknown>, rationale: string): Promise<ClaimResult> {
  const A = "sources.conflicts.decide";
  const db = getDb();
  const conflict = UUID.test(conflictId)
    ? ((await db.from("source_conflicts").select("*").eq("id", conflictId).maybeSingle()).data as { id: string; claim_a_id: string; claim_b_id: string; status: string; academy_id: string | null } | null)
    : null;
  if (!conflict || conflict.academy_id != null) return refused(404, "No such conflict in the source library.", A, { type: "conflict", id: conflictId });
  const target = { type: "conflict", id: conflict.id };
  const was = conflict.status;
  const chosen = body.chosenClaimId;
  if (chosen !== conflict.claim_a_id && chosen !== conflict.claim_b_id) return refused(400, "Choose which of the two claims is followed.", A, target);
  const decision = typeof body.decision === "string" ? body.decision.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (decision.length < 3) return refused(400, "Say what is decided (for example, Follow the 2024 survey).", A, target);
  if (ATTORNEY.test(decision) || ATTORNEY.test(rationale)) return refused(400, NO_ATTORNEY, A, target);
  const last = ((await db.from("authority_decisions").select("version").eq("source_conflict_id", conflict.id).order("version", { ascending: false }).limit(1)).data ?? []) as { version: number }[];
  const version = (last[0]?.version ?? 0) + 1;
  const { error } = await db.from("authority_decisions").insert({
    source_conflict_id: conflict.id, version, chosen_claim_id: chosen, decision, rationale, decided_by_account_id: actor.id,
  });
  if (error?.code === "23505") return refused(409, "Another decision was recorded at the same time. Reload.", A, target);
  if (error) throw new Error(`decision insert failed: ${error.message}`);
  // The database resolves the conflict with the decision (0012); this keeps the fake and the real store in step.
  await db.from("source_conflicts").update({ status: "resolved" }).eq("id", conflict.id);
  const chosenClaim = (await db.from("source_claims").select("claim, source_id").eq("id", chosen).maybeSingle()).data as { claim: string; source_id: string } | null;
  const src = chosenClaim ? ((await db.from("sources").select("title").eq("id", chosenClaim.source_id).maybeSingle()).data as { title: string } | null) : null;
  return {
    ok: true, status: 201, body: { version },
    event: {
      action: A, result: "Completed", target, previous: was, next: `resolved: follow "${src?.title ?? "the chosen source"}" (v${version})`,
      context: `Authority decision v${version}: ${decision}. Followed claim: "${chosenClaim?.claim ?? ""}".`,
    },
  };
}

export async function listConflicts(status: string | null) {
  const db = getDb();
  let q = db.from("source_conflicts").select("*").is("academy_id", null);
  if (status === "open" || status === "resolved") q = q.eq("status", status);
  const conflicts = ((await q.order("created_at", { ascending: false }).limit(200)).data ?? []) as
    { id: string; claim_a_id: string; claim_b_id: string; reasons: string[]; status: string; detected_by: string; created_at: string }[];
  const claimIds = [...new Set(conflicts.flatMap((c) => [c.claim_a_id, c.claim_b_id]))];
  const claims = claimIds.length ? (((await db.from("source_claims").select("*").in("id", claimIds)).data ?? []) as Claim[]) : [];
  const srcIds = [...new Set(claims.map((c) => c.source_id).filter((x): x is string => !!x))];
  const sources = srcIds.length ? (((await db.from("sources").select("id, title, license_class, url").in("id", srcIds)).data ?? []) as Source[]) : [];
  const decisions = conflicts.length
    ? (((await db.from("authority_decisions").select("*").in("source_conflict_id", conflicts.map((c) => c.id)).order("version", { ascending: true })).data ?? []) as
      { source_conflict_id: string; version: number; chosen_claim_id: string; decision: string; rationale: string; decided_at: string; decided_by_account_id: string }[])
    : [];
  const view = (id: string) => {
    const c = claims.find((x) => x.id === id);
    const s = sources.find((x) => x.id === c?.source_id);
    return c ? { id: c.id, claim: c.claim, quote: c.cited_text, source: s ? { id: s.id, title: s.title, license: s.license_class, url: s.url } : null } : null;
  };
  return conflicts.map((c) => ({
    id: c.id, status: c.status, reasons: c.reasons, detectedBy: c.detected_by, createdAt: c.created_at, a: view(c.claim_a_id), b: view(c.claim_b_id),
    decisions: decisions.filter((d) => d.source_conflict_id === c.id).map((d) => ({ version: d.version, chosenClaimId: d.chosen_claim_id, decision: d.decision, rationale: d.rationale, decidedAt: d.decided_at })),
  }));
}

export async function listClaims(sourceId: string | null) {
  let q = getDb().from("source_claims").select("*");
  if (sourceId && UUID.test(sourceId)) q = q.eq("source_id", sourceId);
  const rows = ((await q.order("created_at", { ascending: false }).limit(300)).data ?? []) as Claim[];
  return rows.map((c) => ({ id: c.id, sourceId: c.source_id, claim: c.claim, quote: c.cited_text, citation: c.citation_status, by: c.extracted_by, state: c.state }));
}

/**
 * Retrieval: the best approved chunks for a topic, each with its source and license. Uses embeddings when
 * VOYAGE_API_KEY is set (and within the spend cap), otherwise full-text ranking.
 */
export async function retrieve(topic: string, opts: { limit?: number; accountId?: string; requestId?: string } = {}) {
  const q = topic.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!q) return { mode: "none" as const, results: [] };
  let vector: number[] | null = null;
  try {
    vector = (await embed([q], "query", { accountId: opts.accountId, requestId: opts.requestId }))?.[0] ?? null;
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
  }
  const { data, error } = await getDb().rpc("match_source_chunks", {
    p_query: q, p_embedding: vector ? `[${vector.join(",")}]` : null, p_limit: Math.min(Math.max(opts.limit ?? 8, 1), 20),
  });
  if (error) throw new Error(`retrieval failed: ${error.message}`);
  const rows = (data ?? []) as { chunk_id: string; source_id: string; title: string; url: string | null; license_class: string; license_name: string | null; content: string; is_excerpt: boolean; score: number }[];
  return {
    mode: vector ? ("embedding" as const) : ("full_text" as const),
    results: rows.map((r) => ({
      chunkId: r.chunk_id, text: r.content, isExcerpt: r.is_excerpt, score: Number(r.score),
      citation: { sourceId: r.source_id, title: r.title, url: r.url, license: r.license_class, licenseName: r.license_name },
    })),
  };
}
