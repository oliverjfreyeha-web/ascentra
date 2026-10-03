import { createHash } from "node:crypto";

/**
 * L1: pure helpers for source intake. No network, no database.
 */

/** Days after which an approved source counts as stale until someone re-checks it. PLACEHOLDER (counsel/Owner). */
export const STALE_AFTER_DAYS = 365;
export const MAX_FETCH_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const CHUNK_CHARS = 1500;
export const CHUNK_OVERLAP = 150;
/** At most this many chunks per source (long documents are indexed up to here). */
export const MAX_CHUNKS = 200;
export const LICENSE_CLASSES = ["open", "owner_supplied", "web_summarize_only"] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<(head|title|script|style|noscript|template|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { title: title ? decode(title).replace(/\s+/g, " ").trim() || null : null, text: normalize(decode(body)) };
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function normalize(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Splits text into overlapping chunks on paragraph or sentence boundaries, with a short quote for each. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): { position: number; text: string; quote: string; tokens: number }[] {
  const clean = normalize(text);
  const out: { position: number; text: string; quote: string; tokens: number }[] = [];
  let start = 0;
  while (start < clean.length && out.length < MAX_CHUNKS) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push({ position: out.length, text: piece, quote: firstSentence(piece), tokens: Math.ceil(piece.length / 4) });
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

export function firstSentence(text: string, max = 280): string {
  const m = /^([\s\S]{20,}?[.!?])(\s|$)/.exec(text);
  const s = (m ? m[1] : text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Same words, ignoring case and spacing: is `quote` really in `text`? */
export function quoteIsIn(quote: string, text: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
  const q = n(quote);
  return q.length >= 8 && n(text).includes(q);
}

/**
 * Only public https URLs are fetched (the server fetches them for Owner and Reviewer accounts): no localhost, no
 * private or link-local addresses, no credentials in the URL.
 */
export function checkFetchableUrl(raw: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false, reason: "Enter a full link, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https links can be added." };
  if (url.username || url.password) return { ok: false, reason: "Links with a user name or password can't be added." };
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || privateV4.test(h)
    || h === "::1" || h.startsWith("fc") && h.includes(":") || h.startsWith("fd") && h.includes(":") || h.startsWith("fe80:") || !h.includes(".") && !h.includes(":")) {
    return { ok: false, reason: "That address isn't a public website." };
  }
  url.hash = "";
  return { ok: true, url };
}

/** Words that carry meaning, for a cheap similarity between claims. */
export function contentWords(s: string): Set<string> {
  const stop = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with within your you than then".split(" "));
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !stop.has(w)) ?? []);
}
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}
