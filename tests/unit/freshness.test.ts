/**
 * L3: the freshness cycle's pure parts. Due dates and staleness; the research parser's "Pace of change" section (the
 * market signal: observations with citations, no predictions); the change report's vetting (unknown paragraphs, uncited
 * or copied edits are dropped); and applying approved edits to a copy of the published body. The whole cycle on the real
 * database is in tests/integration/freshness.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no database in these tests"); } }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn(), reverificationErrorResponse: vi.fn() }));

import { REFRESH_SYSTEM, applyEdits, freshnessOf, paragraphsOf, vetReport } from "@/lib/courses/refresh";
import { parseResearch } from "@/lib/courses/research";
import { refreshEstimate } from "@/lib/ai/config";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r", academy_id: "a", refresh_days: 42, last_verified_at: null, queue_status: "idle", queue_note: null, queued_at: null, last_run_at: null, ...over,
}) as Parameters<typeof freshnessOf>[0];
const lesson = (id: string, verified: string) => ({ lesson_id: id, verified_at: verified, published_at: verified });

describe("refresh dates", () => {
  it("is due the refresh interval after the course was last verified (first published, until a report is closed)", () => {
    const f = freshnessOf(row(), [lesson("l1", "2026-08-01T00:00:00Z"), lesson("l2", "2026-08-20T00:00:00Z")], new Date("2026-09-10T00:00:00Z"));
    expect(f).toMatchObject({ days: 42, lastVerifiedAt: "2026-08-01T00:00:00Z", nextRefreshAt: "2026-09-12T00:00:00.000Z", due: false, staleLessons: [] });
    expect(freshnessOf(row({ refresh_days: 30 }), [lesson("l1", "2026-08-01T00:00:00Z")], new Date("2026-09-10T00:00:00Z")).due).toBe(true);
  });

  it("flags a lesson stale once its refresh date passes with no review; closing a report clears it", () => {
    const lessons = [lesson("old", "2026-07-01T00:00:00Z"), lesson("new", "2026-09-01T00:00:00Z")];
    const now = new Date("2026-09-20T00:00:00Z");
    expect(freshnessOf(row(), lessons, now).staleLessons).toEqual(["old"]);
    expect(freshnessOf(row({ last_verified_at: "2026-09-15T00:00:00Z" }), lessons, now).staleLessons).toEqual([]);
  });

  it("estimates one course's refresh (a research pass and a change report)", () => {
    expect(refreshEstimate()).toBe(0.27);
  });
});

describe("the research pass", () => {
  it("asks what changed since the last verification, and how fast the field is changing, without predictions", () => {
    expect(REFRESH_SYSTEM).toMatch(/## Changed[\s\S]*## Outdated[\s\S]*## Pace of change/);
    expect(REFRESH_SYSTEM).toMatch(/no predictions/);
  });

  it("reads the Pace of change section as a market signal with citations", () => {
    const cite = { type: "web_search_result_location", url: "https://example.org/a", title: "A", cited_text: "Three new tools launched this year", encrypted_index: "i" };
    const content = [
      { type: "text", text: "## Changed\n- New routing tools appeared\n## Pace of change\n- ", citations: null },
      { type: "text", text: "Three new lead-routing tools launched this year", citations: [cite] },
      { type: "text", text: "\n- Overall: changing quickly, several new tools and terms in a year", citations: null },
    ] as unknown as Anthropic.ContentBlock[];
    const p = parseResearch(content);
    expect(p.signal).toEqual({ pace: "quick", notes: [
      { text: "Three new lead-routing tools launched this year", sources: [{ url: "https://example.org/a", title: "A" }] },
      { text: "Overall: changing quickly, several new tools and terms in a year", sources: [] },
    ] });
    expect(p.findings.map((f) => f.text)).toEqual(["New routing tools appeared"]);
  });
});

const published = {
  id: "v1", lesson_id: "l1", version: 1, title: "Speed", verified_at: null, published_at: "2026-08-01", last_verified_on: "2026-08-01",
  citations: [{ ref: 1, sourceId: "s1", title: "Study", url: "https://example.org/s", license: "open", lastChecked: "2026-08-01" }],
  body: { summary: "Why speed matters.", sections: [{ heading: "Speed", paragraphs: [{ text: "Reply within five minutes.", refs: [1] }, { text: "Use email follow-ups.", refs: [1] }] }],
    takeaways: [{ text: "Be fast.", refs: [1] }] },
};

describe("the change report", () => {
  const paras = paragraphsOf([published]);
  const evidence = [{ n: 1, sourceId: "s2", title: "New guide", url: "https://example.com/g", text: "Text messages now get faster replies than email (quoted: \"SMS replies are faster\")" }];

  it("numbers every paragraph and takeaway of the published lessons", () => {
    expect([...paras.keys()]).toEqual(["L1.S1.P1", "L1.S1.P2", "L1.T1"]);
  });

  it("keeps cited edits to real paragraphs, and drops uncited, unknown, copied or attorney-approved ones", () => {
    const copied = "Text messages now get faster replies than email (quoted: \"SMS replies are faster\")";
    const out = vetReport({
      doubtful: [{ paragraph: "L1.S1.P2", kind: "outdated", reason: "Email follow-ups are giving way to text." }, { paragraph: "L9.S1.P1", kind: "outdated", reason: "?" }],
      edits: [
        { paragraph: "L1.S1.P2", newText: "Follow up by text message as well as email.", evidence: [1], reason: "Text now gets faster replies." },
        { paragraph: "L1.S1.P1", newText: "Reply fast.", evidence: [], reason: "uncited" },
        { paragraph: "L7.T1", newText: "Be fast.", evidence: [1], reason: "unknown paragraph" },
        { paragraph: "L1.T1", newText: "This is attorney-approved.", evidence: [1], reason: "x" },
      ],
    }, paras, evidence);
    expect(out.doubtful).toEqual([{ lessonId: "l1", lessonTitle: "Speed", versionId: "v1", paragraph: "S1.P2", text: "Use email follow-ups.", kind: "outdated", reason: "Email follow-ups are giving way to text." }]);
    expect(out.edits).toEqual([{
      lesson_id: "l1", base_version_id: "v1", location: "S1.P2", old_text: "Use email follow-ups.", new_text: "Follow up by text message as well as email.",
      sources: [{ sourceId: "s2", title: "New guide", url: "https://example.com/g" }], reason: "Text now gets faster replies.",
    }]);
    const long = vetReport({ doubtful: [], edits: [{ paragraph: "L1.S1.P2", newText: copied.repeat(2), evidence: [1], reason: "copied" }] }, paras, [{ ...evidence[0], text: copied.repeat(2) }]);
    expect(long.edits).toEqual([]);
  });

  it("applies approved edits to a copy of the published body, citing the new source and dating the lesson by its oldest source", () => {
    const info = new Map([
      ["s1", { title: "Study", url: "https://example.org/s", license: "open", lastChecked: "2026-09-30" }],
      ["s2", { title: "New guide", url: "https://example.com/g", license: "web_summarize_only", lastChecked: "2026-10-01" }],
    ]);
    const before = JSON.stringify(published.body);
    const out = applyEdits(published, [{ location: "S1.P2", new_text: "Follow up by text message as well as email.", sources: [{ sourceId: "s2", title: "New guide", url: null }] }], info);
    expect(out.body.sections[0].paragraphs).toEqual([
      { text: "Reply within five minutes.", refs: [1] },
      { text: "Follow up by text message as well as email.", refs: [2] },
    ]);
    expect(out.citations.map((c) => [c.ref, c.sourceId, c.lastChecked])).toEqual([[1, "s1", "2026-09-30"], [2, "s2", "2026-10-01"]]);
    expect(out.lastVerifiedOn).toBe("2026-09-30");
    expect(JSON.stringify(published.body)).toBe(before);
  });

  it("drops a citation the lesson no longer uses and renumbers the rest", () => {
    const one = { ...published, body: { summary: "", sections: [{ heading: "H", paragraphs: [{ text: "Old claim.", refs: [1] }] }], takeaways: [] } };
    const out = applyEdits(one, [{ location: "S1.P1", new_text: "New claim.", sources: [{ sourceId: "s2", title: "New guide", url: null }] }],
      new Map([["s2", { title: "New guide", url: null, license: "open", lastChecked: "2026-10-01" }]]));
    expect(out.citations).toEqual([{ ref: 1, sourceId: "s2", title: "New guide", url: null, license: "open", lastChecked: "2026-10-01" }]);
    expect(out.body.sections[0].paragraphs[0].refs).toEqual([1]);
  });
});
