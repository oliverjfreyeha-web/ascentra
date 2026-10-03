import "server-only";
import { getDb } from "@/lib/db";

/**
 * L2: the material Claude works from when planning and writing a course: APPROVED library sources only, as numbered
 * passages (their cited claims and stored passages), each tied to its source. The numbers let the model cite, and
 * let the server turn its references back into real citations. For a web_summarize_only source the stored passages
 * are short quotes; nothing more of another site is ever sent or kept.
 */
export type CourseSource = {
  id: string; title: string; url: string | null; license: string; lastChecked: string | null; pageAge: string | null; researchRunId: string | null;
};
export type Passage = { n: number; sourceId: string; claimId: string | null; quote: string; text: string };

const MAX_PASSAGES = 80;
const PER_SOURCE = 8;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export async function approvedSources(ids: string[]): Promise<CourseSource[]> {
  if (!ids.length) return [];
  const rows = ((await getDb().from("sources").select("id, title, url, license_class, status, academy_id, last_checked_at, approved_at, page_age, research_run_id")
    .in("id", ids)).data ?? []) as {
      id: string; title: string; url: string | null; license_class: string; status: string; academy_id: string | null;
      last_checked_at: string | null; approved_at: string | null; page_age: string | null; research_run_id: string | null;
    }[];
  return rows.filter((s) => s.academy_id == null && s.status === "approved").map((s) => ({
    id: s.id, title: s.title, url: s.url, license: s.license_class, lastChecked: day(s.last_checked_at ?? s.approved_at),
    pageAge: s.page_age, researchRunId: s.research_run_id,
  }));
}

export async function passagesFor(sources: CourseSource[]): Promise<Passage[]> {
  if (!sources.length) return [];
  const db = getDb();
  const ids = sources.map((s) => s.id);
  const claims = ((await db.from("source_claims").select("id, source_id, claim, cited_text, citation_status").in("source_id", ids)).data ?? []) as
    { id: string; source_id: string; claim: string; cited_text: string | null; citation_status: string }[];
  const chunks = ((await db.from("source_chunks").select("id, source_id, position, content").in("source_id", ids).order("position", { ascending: true })).data ?? []) as
    { id: string; source_id: string; position: number; content: string }[];
  const out: Passage[] = [];
  for (const s of sources) {
    const used = new Set<string>();
    let count = 0;
    for (const c of claims.filter((c) => c.source_id === s.id && c.citation_status === "cited" && c.cited_text)) {
      if (count >= PER_SOURCE || out.length >= MAX_PASSAGES) break;
      used.add(c.cited_text!);
      out.push({ n: out.length + 1, sourceId: s.id, claimId: c.id, quote: c.cited_text!.slice(0, 300), text: `${c.claim} (quoted: "${c.cited_text}")`.slice(0, 600) });
      count++;
    }
    for (const ch of chunks.filter((c) => c.source_id === s.id && !used.has(c.content))) {
      if (count >= PER_SOURCE || out.length >= MAX_PASSAGES) break;
      out.push({ n: out.length + 1, sourceId: s.id, claimId: null, quote: ch.content.slice(0, 300), text: ch.content.slice(0, 600) });
      count++;
    }
  }
  return out;
}

/** The sources and passages as the model sees them. */
export function renderContext(sources: CourseSource[], passages: Passage[]): string {
  const label = new Map(sources.map((s, i) => [s.id, `S${i + 1}`]));
  return [
    "Approved sources:",
    ...sources.map((s) => `[${label.get(s.id)}] ${s.title}${s.url ? ` <${s.url}>` : ""} (license: ${s.license}; last checked ${s.lastChecked ?? "unknown"}${s.pageAge ? `; page dated ${s.pageAge}` : ""})`),
    "",
    "Passages (cite them by number):",
    ...passages.map((p) => `P${p.n} [${label.get(p.sourceId)}]: ${p.text}`),
  ].join("\n");
}
