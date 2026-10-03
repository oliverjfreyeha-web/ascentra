import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, assertPromptSafe, webResearch } from "@/lib/ai";
import { AI_MODELS, WEB_SEARCH, estimateUsd } from "@/lib/ai/config";
import { checkFetchableUrl } from "@/lib/sources/text";
import { ATTORNEY, DEFAULT_FRESHNESS, clean, isAudience, refused, type Result } from "./common";

/**
 * L2 step 1: research a topic. Claude (Haiku 4.5) searches the web with Anthropic's web search tool and answers in
 * two sections: current findings and what has been replaced. Every finding keeps the citation the API attached to it
 * (the page's URL and title, and the words cited). What it finds goes into the source ledger as PROPOSED: the
 * sources can't be cited, searched or used for a blueprint until a Reviewer (or the Owner) approves them. Only short
 * quotes are kept (web_summarize_only); never a page's full text. The prompt holds the topic, the audience level and
 * the freshness question, nothing else: no learner data, no secrets.
 */
const A = "sources.research";
const MAX_SOURCES = 12;
const MAX_FINDINGS = 15;
const MAX_OUTDATED = 10;

export const RESEARCH_SYSTEM = [
  "You research a topic for a course on a learning platform. Search the web for current, reputable sources:",
  "official documentation, standards bodies, primary research, and established publications. Prefer recent material.",
  "Answer in exactly this form and nothing else:",
  "## Current",
  "- one finding per line, in your own words, each supported by a search result",
  "## Outdated",
  "- OLD PRACTICE, TOOL OR TERM -> WHAT REPLACED IT: one sentence on when and why, supported by a search result",
  "Rules:",
  "- 5 to 12 lines under Current; up to 8 under Outdated (write \"- None found\" if there are none).",
  "- Report what the sources say and when; don't rank sources or call any of them the best.",
  "- Don't describe anything as legally or attorney approved.",
].join("\n");

export type Finding = { text: string; citations: { url: string; title: string | null; citedText: string }[] };
export type OutdatedNote = { item: string; replacedBy: string | null; note: string; sources: { url: string; title: string | null }[] };
export type ParsedResearch = { findings: Finding[]; outdated: OutdatedNote[]; pages: Map<string, { title: string; pageAge: string | null }> };

/**
 * Reads the answer: the text with the API's web citations attached to the lines they support, and the search
 * results' page ages. Pure: tested without the network.
 */
export function parseResearch(content: Anthropic.ContentBlock[]): ParsedResearch {
  const pages = new Map<string, { title: string; pageAge: string | null }>();
  let text = "";
  const ranges: { start: number; end: number; cites: Finding["citations"] }[] = [];
  let afterOther = false;
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") pages.set(r.url, { title: r.title, pageAge: r.page_age ?? null });
    }
    if (block.type !== "text") {
      afterOther = true;
      continue;
    }
    // Text on either side of a search is a separate passage: start it on its own line.
    if (afterOther && text && !text.endsWith("\n")) text += "\n";
    afterOther = false;
    const start = text.length;
    text += block.text;
    const cites = (block.citations ?? []).flatMap((c) =>
      c.type === "web_search_result_location" ? [{ url: c.url, title: c.title ?? null, citedText: c.cited_text }] : []);
    if (cites.length) ranges.push({ start, end: text.length, cites });
  }

  const findings: Finding[] = [];
  const outdated: OutdatedNote[] = [];
  let section: "current" | "outdated" | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;
    const t = line.trim();
    if (/^#+\s*/.test(t)) {
      section = /outdated|replaced/i.test(t) ? "outdated" : /current|finding/i.test(t) ? "current" : null;
      continue;
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(t)?.[1]?.trim();
    if (!section || !item || /^none found\.?$/i.test(item)) continue;
    const seen = new Set<string>();
    const cites = ranges.filter((r) => r.start < end && r.end > start).flatMap((r) => r.cites)
      .filter((c) => (seen.has(c.url + c.citedText) ? false : (seen.add(c.url + c.citedText), true)));
    if (section === "current" && findings.length < MAX_FINDINGS) findings.push({ text: item.slice(0, 500), citations: cites });
    if (section === "outdated" && outdated.length < MAX_OUTDATED) {
      const m = /^(.+?)\s*(?:->|→|—>|=>)\s*(.+?)(?::\s+(.*))?$/.exec(item);
      const srcs = [...new Map(cites.map((c) => [c.url, { url: c.url, title: c.title }])).values()];
      outdated.push(m
        ? { item: m[1].slice(0, 200), replacedBy: m[2].slice(0, 200), note: (m[3] ?? "").slice(0, 400), sources: srcs }
        : { item: item.slice(0, 200), replacedBy: null, note: "", sources: srcs });
    }
  }
  return { findings, outdated, pages };
}

type Body = Record<string, unknown>;

export async function runResearch(actor: Account, body: Body, requestId?: string): Promise<Result> {
  const topic = clean(body.topic, 200);
  const audience = body.audience;
  const freshness = clean(body.freshness, 500) || DEFAULT_FRESHNESS;
  if (topic.length < 3) return refused(400, "Give the topic to research.", A);
  if (!isAudience(audience)) return refused(400, "Choose the audience level: beginner, intermediate or advanced.", A);
  if (ATTORNEY.test(topic) || ATTORNEY.test(freshness)) return refused(400, "ASCENTRA never calls anything attorney-approved. Reword it.", A);
  try {
    assertPromptSafe(topic, freshness);
  } catch (err) {
    if (err instanceof AiUnavailable) return refused(400, err.message, A);
    throw err;
  }

  const db = getDb();
  const estimate = estimateUsd("research");
  let result: Awaited<ReturnType<typeof webResearch>>;
  try {
    result = await webResearch({
      system: RESEARCH_SYSTEM,
      user: `Topic: ${topic}\nAudience level: ${audience}\nFreshness question: ${freshness}`,
      maxUses: WEB_SEARCH.maxUses, estimateUsd: estimate, accountId: actor.id, requestId,
    });
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    const status = err.code === "ai_off" ? 503 : err.code === "cap_reached" ? 429 : 502;
    return refused(status, err.message, A, { type: "research", id: topic, label: topic });
  }

  const parsed = parseResearch(result.content);
  const { data: run, error: runErr } = await db.from("research_runs").insert({
    topic, audience_level: audience, freshness_question: freshness, status: "completed", model: AI_MODELS["sources.research"],
    search_count: result.searches, outdated_notes: parsed.outdated, cost_usd: result.costUsd, created_by_account_id: actor.id,
  }).select("id").single();
  if (runErr) throw new Error(`research run insert failed: ${runErr.message}`);
  const runId = (run as { id: string }).id;

  // One proposed source per cited page (public https only), with the cited words as its only stored text.
  const quotesByUrl = new Map<string, { title: string | null; quotes: string[] }>();
  for (const f of parsed.findings) for (const c of f.citations) {
    const e = quotesByUrl.get(c.url) ?? { title: c.title, quotes: [] };
    if (!e.quotes.includes(c.citedText)) e.quotes.push(c.citedText);
    quotesByUrl.set(c.url, e);
  }
  const sourceIdByUrl = new Map<string, string>();
  const chunkIds = new Map<string, string>(); // url + quote → chunk id
  let added = 0;
  const now = new Date().toISOString();
  for (const [url, e] of [...quotesByUrl].slice(0, MAX_SOURCES)) {
    const checked = checkFetchableUrl(url);
    if (!checked.ok) continue;
    const page = parsed.pages.get(url);
    const title = clean(page?.title ?? e.title ?? checked.url.hostname, 300) || checked.url.hostname;
    const ins = await db.from("sources").insert({
      title, source_type: "Web research", url: checked.url.toString(), kind: "url", license_class: "web_summarize_only",
      status: "proposed", found_at: now, last_checked_at: now, added_by_account_id: actor.id, research_run_id: runId,
      page_age: page?.pageAge ? clean(page.pageAge, 100) : null,
    }).select("id").single();
    let id: string;
    if (ins.error?.code === "23505") {
      // Already in the library: the finding cites it as it is (approved or not); its status doesn't change.
      const pattern = checked.url.toString().replace(/[\\%_]/g, "\\$&");
      const existing = (((await db.from("sources").select("id").is("academy_id", null).ilike("url", pattern).limit(1)).data ?? []) as { id: string }[])[0];
      if (!existing) continue;
      id = existing.id;
    } else if (ins.error) {
      throw new Error(`research source insert failed: ${ins.error.message}`);
    } else {
      id = (ins.data as { id: string }).id;
      added++;
      const items = e.quotes.slice(0, 20).map((q, i) => ({ position: i, text: q, quote: q }));
      const { error } = await db.rpc("put_source_chunks", { p_source: id, p_chunks: items });
      if (error) throw new Error(`research chunks failed: ${error.message}`);
      const chunks = ((await db.from("source_chunks").select("id, position").eq("source_id", id)).data ?? []) as { id: string; position: number }[];
      for (const c of chunks) chunkIds.set(`${url}\u0000${e.quotes[c.position]}`, c.id);
    }
    sourceIdByUrl.set(url, id);
  }

  // Findings become proposed claims: cited (first citation's source and words) or marked as having no source.
  const claims = parsed.findings.filter((f) => !ATTORNEY.test(f.text)).map((f) => {
    const c = f.citations.find((x) => sourceIdByUrl.has(x.url));
    return c
      ? { source_id: sourceIdByUrl.get(c.url), chunk_id: chunkIds.get(`${c.url}\u0000${c.citedText}`) ?? null, claim: f.text, cited_text: c.citedText.slice(0, 400),
          citation_status: "cited", extracted_by: "ai", state: "proposed", added_by_account_id: actor.id, research_run_id: runId }
      : { source_id: null, claim: f.text, citation_status: "no_source", extracted_by: "ai", state: "proposed", added_by_account_id: actor.id, research_run_id: runId };
  });
  if (claims.length) {
    const { error } = await db.from("source_claims").insert(claims);
    if (error) throw new Error(`research claims insert failed: ${error.message}`);
  }
  await db.from("research_runs").update({ source_count: sourceIdByUrl.size, claim_count: claims.length }).eq("id", runId);

  const uncited = claims.filter((c) => c.citation_status === "no_source").length;
  return {
    ok: true, status: 201,
    body: { id: runId, sources: sourceIdByUrl.size, newSources: added, claims: claims.length, uncited, outdated: parsed.outdated.length, searches: result.searches, costUsd: result.costUsd },
    event: {
      action: A, result: "Completed", target: { type: "research", id: runId, label: topic }, previous: "none",
      next: `${added} new proposed source(s), ${claims.length} claim(s)`,
      context: `Researched "${topic}" (${audience}) with web search (${result.searches} search(es), $${result.costUsd.toFixed(4)}): ${sourceIdByUrl.size} source(s) (${added} new, proposed), ${claims.length} claim(s)${uncited ? ` (${uncited} with no source, marked)` : ""}, ${parsed.outdated.length} outdated note(s). Nothing is usable until a Reviewer approves the sources.`,
    },
  };
}

/** The research runs, newest first, with their outdated notes and how many of their sources are approved. */
export async function listResearch() {
  const db = getDb();
  const runs = ((await db.from("research_runs").select("*").order("created_at", { ascending: false }).limit(50)).data ?? []) as {
    id: string; topic: string; audience_level: string; freshness_question: string; status: string; search_count: number; source_count: number;
    claim_count: number; outdated_notes: OutdatedNote[]; cost_usd: number | string; created_at: string;
  }[];
  const ids = runs.map((r) => r.id);
  const sources = ids.length
    ? (((await db.from("sources").select("id, title, url, status, page_age, research_run_id").in("research_run_id", ids)).data ?? []) as
      { id: string; title: string; url: string; status: string; page_age: string | null; research_run_id: string }[])
    : [];
  return runs.map((r) => ({
    id: r.id, topic: r.topic, audience: r.audience_level, freshness: r.freshness_question, status: r.status, searches: r.search_count,
    claims: r.claim_count, costUsd: Number(r.cost_usd), createdAt: r.created_at, outdated: r.outdated_notes,
    sources: sources.filter((s) => s.research_run_id === r.id).map((s) => ({ id: s.id, title: s.title, url: s.url, status: s.status, pageAge: s.page_age })),
  }));
}
