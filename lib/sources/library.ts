import "server-only";
import { randomUUID } from "node:crypto";
import type { Account } from "@/lib/auth";
import type { AuditInput } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { AiUnavailable, embed } from "@/lib/ai";
import {
  LICENSE_CLASSES, MAX_FETCH_BYTES, MAX_UPLOAD_BYTES, STALE_AFTER_DAYS, checkFetchableUrl, chunkText, htmlToText, normalize, sha256,
  type LicenseClass,
} from "./text";

/**
 * L1: the source library (the ledger). Sources come in by link, by uploaded document (kept privately in Supabase
 * storage), or from the Owner's open-license list. Each is split into chunks for search (full-text and, when
 * VOYAGE_API_KEY is set, embeddings). Only approved sources are returned by search or can be cited by lessons.
 */
type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type LibResult<T = Record<string, unknown>> =
  | { ok: true; status?: number; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
const refused = (status: number, reason: string, action: string, target: Event["target"] = null): LibResult<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

export const BUCKET = "source-documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LICENSE_LABEL: Record<LicenseClass, string> = { open: "open license", owner_supplied: "owner-supplied", web_summarize_only: "web (summarize only)" };

export type SourceRow = {
  id: string; title: string; url: string | null; kind: "url" | "document" | "open_list"; license_class: LicenseClass; license_name: string | null;
  status: "proposed" | "approved" | "rejected" | "stale"; found_at: string; added_by_account_id: string | null;
  approved_by_account_id: string | null; approved_at: string | null; last_checked_at: string | null; storage_path: string | null;
  mime_type: string | null; content_sha256: string | null; chunk_count: number; created_at: string;
};

async function sourceById(id: string): Promise<SourceRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await getDb().from("sources").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`source lookup failed: ${error.message}`);
  return data as SourceRow | null;
}

const isLicense = (v: unknown): v is LicenseClass => typeof v === "string" && (LICENSE_CLASSES as readonly string[]).includes(v);
const cleanTitle = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 300) : "");
const describe = (s: Pick<SourceRow, "title" | "license_class" | "status">) => `"${s.title}" (${LICENSE_LABEL[s.license_class]}, ${s.status})`;

/** Approved sources whose last check is older than STALE_AFTER_DAYS become stale (not citable until re-approved). */
export async function markStale(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const { data, error } = await getDb().from("sources").update({ status: "stale" }).is("academy_id", null).eq("status", "approved")
    .lte("last_checked_at", cutoff).select("id");
  if (error) throw new Error(`stale marking failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function listSources(filter: { license?: string | null; status?: string | null; olderThanDays?: number | null }) {
  await markStale();
  let q = getDb().from("sources").select("*").is("academy_id", null);
  if (filter.license && isLicense(filter.license)) q = q.eq("license_class", filter.license);
  if (filter.status && ["proposed", "approved", "rejected", "stale"].includes(filter.status)) q = q.eq("status", filter.status);
  if (filter.olderThanDays && filter.olderThanDays > 0) q = q.lte("found_at", new Date(Date.now() - filter.olderThanDays * 86_400_000).toISOString());
  const { data, error } = await q.order("found_at", { ascending: false }).limit(500);
  if (error) throw new Error(`source list failed: ${error.message}`);
  return ((data ?? []) as SourceRow[]).map((s) => ({
    id: s.id, title: s.title, url: s.url, kind: s.kind, licenseClass: s.license_class, licenseName: s.license_name, status: s.status,
    foundAt: s.found_at, approvedAt: s.approved_at, approvedBy: s.approved_by_account_id, lastCheckedAt: s.last_checked_at,
    chunks: s.chunk_count, hasFile: !!s.storage_path,
  }));
}

/** Splits, embeds (when configured) and stores the chunks. Embedding problems fall back to full-text search only. */
async function ingest(source: Pick<SourceRow, "id">, text: string, who: { accountId: string; requestId?: string }): Promise<{ chunks: number; embedded: boolean }> {
  const chunks = chunkText(text);
  let vectors: number[][] | null = null;
  try {
    vectors = await embed(chunks.map((c) => c.text), "document", who);
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    console.error("[sources] embeddings skipped:", err.message);
  }
  const items = chunks.map((c, i) => ({ ...c, ...(vectors ? { embedding: vectors[i] } : {}) }));
  const { data, error } = await getDb().rpc("put_source_chunks", { p_source: source.id, p_chunks: items });
  if (error) throw new Error(`chunk store failed: ${error.message}`);
  return { chunks: Number(data ?? items.length), embedded: !!vectors };
}

async function insertSource(row: Record<string, unknown>): Promise<{ id: string } | "duplicate"> {
  const { data, error } = await getDb().from("sources").insert(row).select("id").single();
  if (error?.code === "23505") return "duplicate";
  if (error) throw new Error(`source insert failed: ${error.message}`);
  return data as { id: string };
}

/** Reads a public web page or PDF: at most MAX_FETCH_BYTES, 15 seconds, https only. */
async function fetchText(url: URL): Promise<{ title: string | null; text: string; mime: string } | { error: string; status?: number }> {
  let res: Response;
  let at = url;
  const signal = AbortSignal.timeout(15_000);
  // Redirects are followed by hand (at most 3), each target checked before it's requested.
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(at, { redirect: "manual", signal, headers: { "user-agent": "ASCENTRA source library (+https)" } });
    } catch {
      return { error: "The page didn't answer within 15 seconds." };
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    if (hop >= 3) return { error: "The link redirected too many times." };
    const next = checkFetchableUrl(new URL(location, at).toString());
    if (!next.ok) return { error: "The link redirected to an address that isn't a public website." };
    at = next.url;
  }
  if (!res.ok) return { error: `The page answered ${res.status}.`, status: res.status };
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FETCH_BYTES) return { error: "The page is larger than 2 MB." };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) return { error: "The page is larger than 2 MB." };
  if (mime === "application/pdf") return { title: null, text: await pdfText(buf), mime };
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    const page = htmlToText(new TextDecoder().decode(buf));
    return { ...page, mime };
  }
  if (mime.startsWith("text/")) return { title: null, text: normalize(new TextDecoder().decode(buf)), mime };
  return { error: `This kind of content (${mime || "unknown"}) can't be read. Use a web page, a PDF or plain text.` };
}

/**
 * L3: reads a source's page again for the freshness check: "gone" when the site says it no longer exists (404/410),
 * "unreachable" when it can't be read now (it may be back tomorrow), otherwise the page's text.
 */
export async function refetchPage(raw: string): Promise<{ ok: true; text: string } | { ok: false; gone: boolean; detail: string }> {
  const checked = checkFetchableUrl(raw);
  if (!checked.ok) return { ok: false, gone: false, detail: "The link isn't a public https address." };
  const page = await fetchText(checked.url);
  if ("error" in page) return { ok: false, gone: page.status === 404 || page.status === 410, detail: page.error };
  return { ok: true, text: page.text };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return normalize(Array.isArray(text) ? text.join("\n\n") : text);
}

const who = (a: Account, requestId?: string) => ({ accountId: a.id, requestId });

/** Add by link. Body: { url, title?, licenseClass, licenseName? }. Starts as proposed. */
export async function addFromUrl(actor: Account, body: Record<string, unknown>, requestId?: string, viaOpenList?: { title: string; licenseName: string }): Promise<LibResult> {
  const A = "sources.library.add";
  const checked = checkFetchableUrl(body.url);
  if (!checked.ok) return refused(400, checked.reason, A);
  const license = viaOpenList ? "open" : body.licenseClass;
  if (!isLicense(license)) return refused(400, "Choose the license class: open, owner_supplied or web_summarize_only.", A);
  if (license === "owner_supplied") return refused(400, "An owner-supplied source is an uploaded document, not a link.", A);
  const page = await fetchText(checked.url);
  if ("error" in page) return refused(422, page.error, A, { type: "source", id: checked.url.toString() });
  if (page.text.length < 50) return refused(422, "The page has too little readable text to use as a source.", A, { type: "source", id: checked.url.toString() });
  const title = viaOpenList?.title ?? (cleanTitle(body.title) || page.title || checked.url.hostname);
  const now = new Date().toISOString();
  const row = await insertSource({
    title, source_type: viaOpenList ? "Open license list" : "Web page", url: checked.url.toString(), kind: viaOpenList ? "open_list" : "url",
    license_class: license, license_name: viaOpenList?.licenseName ?? (cleanTitle(body.licenseName) || null), status: "proposed",
    found_at: now, last_checked_at: now, added_by_account_id: actor.id, mime_type: page.mime, content_sha256: sha256(page.text),
  });
  if (row === "duplicate") return refused(409, "This source is already in the library.", A, { type: "source", id: checked.url.toString() });
  const r = await ingest(row, page.text, who(actor, requestId));
  return {
    ok: true, status: 201, body: { id: row.id, chunks: r.chunks, embedded: r.embedded },
    event: {
      action: A, result: "Completed", target: { type: "source", id: row.id, label: title }, previous: "none",
      next: `proposed (${LICENSE_LABEL[license]})`,
      context: `Added ${checked.url.toString()} to the source library as proposed: ${r.chunks} chunk(s) for search${r.embedded ? " with embeddings" : " (full-text only)"}. ${license === "web_summarize_only" ? "Only short quotes are kept; the page's text isn't stored." : ""}`.trim(),
    },
  };
}

/** Add from the Owner's open-license list. Body: { openListId }. */
export async function addFromOpenList(actor: Account, body: Record<string, unknown>, requestId?: string): Promise<LibResult> {
  const id = typeof body.openListId === "string" && UUID.test(body.openListId) ? body.openListId : null;
  const item = id ? ((await getDb().from("open_license_sources").select("*").eq("id", id).maybeSingle()).data as { title: string; url: string; license_name: string } | null) : null;
  if (!item) return refused(404, "That entry isn't on the open-license list.", "sources.library.add");
  return addFromUrl(actor, { url: item.url }, requestId, { title: item.title, licenseName: item.license_name });
}

/** Add an uploaded document (PDF or text), kept privately in Supabase storage. */
export async function addDocument(actor: Account, form: FormData, requestId?: string): Promise<LibResult> {
  const A = "sources.library.add";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return refused(400, "Choose a PDF or text file.", A);
  if (file.size > MAX_UPLOAD_BYTES) return refused(413, "The file is larger than 4 MB.", A);
  const license = form.get("licenseClass");
  if (!isLicense(license)) return refused(400, "Choose the license class: open, owner_supplied or web_summarize_only.", A);
  const name = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "document";
  const mime = file.type === "application/pdf" || /\.pdf$/i.test(name) ? "application/pdf" : /\.(md|markdown)$/i.test(name) ? "text/markdown" : file.type.startsWith("text/") || /\.txt$/i.test(name) ? "text/plain" : null;
  if (!mime) return refused(415, "Only PDF, plain text and Markdown files can be added.", A);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = mime === "application/pdf" ? await pdfText(bytes) : normalize(new TextDecoder().decode(bytes));
  } catch {
    return refused(422, "The file couldn't be read. Is it a valid PDF?", A);
  }
  if (text.length < 50) return refused(422, "The file has too little readable text (a scanned PDF needs text, not images).", A);
  const digest = sha256(bytes);
  const path = `${randomUUID()}/${name}`;
  const up = await getDb().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) {
    console.error("[sources] storage upload failed:", up.error.message);
    return refused(503, "The document store isn't available (is the source-documents bucket there? apply db/apply/L1.sql). Nothing was saved.", A);
  }
  const title = cleanTitle(form.get("title")) || name;
  const now = new Date().toISOString();
  const row = await insertSource({
    title, source_type: "Uploaded document", kind: "document", license_class: license, license_name: cleanTitle(form.get("licenseName")) || null,
    status: "proposed", found_at: now, last_checked_at: now, added_by_account_id: actor.id, storage_path: path, mime_type: mime, content_sha256: digest,
  });
  if (row === "duplicate") {
    await getDb().storage.from(BUCKET).remove([path]);
    return refused(409, "This document is already in the library.", A);
  }
  const r = await ingest(row, text, who(actor, requestId));
  return {
    ok: true, status: 201, body: { id: row.id, chunks: r.chunks, embedded: r.embedded },
    event: {
      action: A, result: "Completed", target: { type: "source", id: row.id, label: title }, previous: "none", next: `proposed (${LICENSE_LABEL[license]})`,
      context: `Uploaded "${name}" (${Math.round(file.size / 1024)} KB, stored privately) to the source library as proposed: ${r.chunks} chunk(s).`,
    },
  };
}

/** Approve (re-approving a stale source re-checks it) or reject. An owner-supplied source is approved by the Owner. */
export async function decideSource(actor: Account, id: string, decision: "approved" | "rejected"): Promise<LibResult> {
  const A = decision === "approved" ? "sources.library.approve" : "sources.library.reject";
  const s = await sourceById(id);
  if (!s) return refused(404, "No such source.", A, { type: "source", id });
  const target = { type: "source", id: s.id, label: s.title };
  if (s.status === decision && decision === "rejected") return refused(409, "This source is already rejected.", A, target);
  if (decision === "approved" && s.status === "approved") return refused(409, "This source is already approved.", A, target);
  if (decision === "approved" && s.license_class === "owner_supplied" && actor.roleKey !== "owner") {
    return refused(403, "An owner-supplied source is approved by the Owner.", A, target);
  }
  const before = describe(s);
  const wasStale = s.status === "stale";
  const now = new Date().toISOString();
  const fields = decision === "approved"
    ? { status: "approved", approved_by_account_id: actor.id, approved_at: now, last_checked_at: now }
    : { status: "rejected" };
  const { error } = await getDb().from("sources").update(fields).eq("id", s.id);
  if (error) throw new Error(`source ${decision} failed: ${error.message}`);
  return {
    ok: true, body: { id: s.id, status: decision },
    event: {
      action: A, result: "Completed", target, previous: before, next: describe({ ...s, status: decision }),
      context: decision === "approved"
        ? `Approved ${before}: lessons can cite it and search returns it.${wasStale ? " It was stale; this approval re-checks it." : ""}`
        : `Rejected ${describe(s)}: it's never returned by search or cited.`,
    },
  };
}

// ============ The Owner's open-license list ============

export async function openList() {
  const { data, error } = await getDb().from("open_license_sources").select("*").order("title", { ascending: true });
  if (error) throw new Error(`open list failed: ${error.message}`);
  return (data ?? []) as { id: string; title: string; url: string; license_name: string; notes: string | null }[];
}

export async function addToOpenList(actor: Account, body: Record<string, unknown>): Promise<LibResult> {
  const A = "sources.open_list.edit";
  const checked = checkFetchableUrl(body.url);
  if (!checked.ok) return refused(400, checked.reason, A);
  const title = cleanTitle(body.title);
  const license = cleanTitle(body.licenseName);
  if (!title || !license) return refused(400, "Give a title and the license (for example CC BY 4.0).", A);
  const { data, error } = await getDb().from("open_license_sources").insert({
    title, url: checked.url.toString(), license_name: license, notes: cleanTitle(body.notes) || null, added_by_account_id: actor.id,
  }).select("id").single();
  if (error?.code === "23505") return refused(409, "That link is already on the list.", A);
  if (error) throw new Error(`open list insert failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { id: (data as { id: string }).id },
    event: { action: A, result: "Completed", target: { type: "open_license_source", id: (data as { id: string }).id, label: title }, previous: "none", next: `${title} · ${license}`, context: `Added "${title}" (${license}) to the open-license list.` },
  };
}

export async function removeFromOpenList(actor: Account, id: string): Promise<LibResult> {
  const A = "sources.open_list.edit";
  if (!UUID.test(id)) return refused(404, "No such entry.", A);
  const db = getDb();
  const row = (await db.from("open_license_sources").select("title, license_name").eq("id", id).maybeSingle()).data as { title: string; license_name: string } | null;
  if (!row) return refused(404, "No such entry.", A, { type: "open_license_source", id });
  const { error } = await db.from("open_license_sources").delete().eq("id", id);
  if (error) throw new Error(`open list delete failed: ${error.message}`);
  void actor;
  return {
    ok: true, body: { removed: true },
    event: { action: A, result: "Completed", target: { type: "open_license_source", id, label: row.title }, previous: `${row.title} · ${row.license_name}`, next: "removed", context: `Removed "${row.title}" from the open-license list. Sources already added from it stay.` },
  };
}
