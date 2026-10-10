/**
 * I1: how the Import course page reads the check and create answers. Takes a response body exactly as the route sends
 * it and returns the typed value, or null when the shape isn't the one expected. tests/integration/course-import.test.ts
 * passes the real routes' answers through it.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type ImportProblem = { path: string; message: string; group: string };
export type ImportResult = {
  ok: boolean; problems: ImportProblem[]; warnings: { path: string; message: string }[]; bytes: number; sha256: string;
  summary: {
    topic: string | null; title: string | null; sizeTier: string | null; modules: number; lessons: number; items: Record<string, number>; videoSlots: number;
    sources: number; resources: number; resourcesHidden: number; capstone: boolean; notices: number; newDraftVersion: boolean;
  };
  created?: { courseId: string; version: number; academySlug: string; counts: Record<string, number>; editor: string; checklist: string } | null;
};
export function importResultFrom(body: unknown): ImportResult | null {
  if (!obj(body) || typeof body.ok !== "boolean" || !arr(body.problems) || !arr(body.warnings) || !obj(body.summary) || !num(body.bytes) || !str(body.sha256)) return null;
  if (!body.problems.every((p) => obj(p) && str(p.path) && str(p.message) && str(p.group))) return null;
  const s = body.summary;
  if (!num(s.modules) || !num(s.lessons) || !obj(s.items) || !num(s.videoSlots) || !num(s.sources) || !num(s.resources)) return null;
  if (!(body.created === undefined || body.created === null || (obj(body.created) && str(body.created.editor) && num(body.created.version)))) return null;
  return body as unknown as ImportResult;
}
