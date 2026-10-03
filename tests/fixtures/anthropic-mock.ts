/**
 * A stand-in for @anthropic-ai/sdk in tests: `vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"))`.
 * Every request is recorded in `ai.requests`; each test sets what create / parse / retrieve answer.
 */
type Req = Record<string, unknown>;
export const ai = {
  requests: [] as { kind: "create" | "parse"; params: Req }[],
  create: (async () => { throw new Error("ai.create not set"); }) as (p: Req) => Promise<unknown>,
  parse: (async () => { throw new Error("ai.parse not set"); }) as (p: Req) => Promise<unknown>,
  retrieve: (async (id: string) => ({ id })) as (id: string) => Promise<unknown>,
  reset() {
    this.requests = [];
    this.create = async () => { throw new Error("ai.create not set"); };
    this.parse = async () => { throw new Error("ai.parse not set"); };
  },
};

export class APIError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}

export default class Anthropic {
  static APIError = APIError;
  static AuthenticationError = AuthenticationError;
  static PermissionDeniedError = PermissionDeniedError;
  messages = {
    create: (p: Req) => { ai.requests.push({ kind: "create", params: p }); return ai.create(p); },
    parse: (p: Req) => { ai.requests.push({ kind: "parse", params: p }); return ai.parse(p); },
  };
  models = { retrieve: (id: string) => ai.retrieve(id) };
}

const cite = (url: string, title: string, cited: string) => ({ type: "web_search_result_location", url, title, cited_text: cited, encrypted_index: "idx" });
const result = (url: string, title: string, age: string) => ({ type: "web_search_result", url, title, page_age: age, encrypted_content: "enc" });

/** A research answer shaped like the API's: search results, then text blocks carrying web citations. */
export function researchAnswer() {
  return {
    stop_reason: "end_turn",
    usage: { input_tokens: 12_000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } },
    content: [
      { type: "text", text: "I'll search for current guidance.", citations: null },
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "lead response time" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [
        result("https://example.org/speed", "Speed to lead study", "March 2026"),
        result("https://example.com/desk", "Service desk guide", "January 2026"),
        result("https://example.net/old", "Lead generation trends", "2025"),
      ] },
      { type: "text", text: "## Current\n- ", citations: null },
      { type: "text", text: "Reply to new leads within five minutes", citations: [cite("https://example.org/speed", "Speed to lead study", "Respond to new leads within five minutes.")] },
      { type: "text", text: "\n- ", citations: null },
      { type: "text", text: "A same-hour reply works for most service businesses", citations: [cite("https://example.com/desk", "Service desk guide", "a same-hour reply converts as well as a five-minute reply")] },
      { type: "text", text: "\n- Speed matters most in the first hour\n\n## Outdated\n- ", citations: null },
      { type: "text", text: "Bought lead lists -> instant routing of inbound forms: bulk lists are rarely used now", citations: [cite("https://example.net/old", "Lead generation trends", "Bought lead lists have largely been replaced by instant routing")] },
    ],
  };
}

/** The passage numbers in a prompt whose text matches `re` ("P3 [S1]: ..."). */
export function passagesMatching(prompt: string, re: RegExp): number[] {
  return [...prompt.matchAll(/^P(\d+) \[S\d+\]: (.*)$/gm)].filter((m) => re.test(m[2])).map((m) => Number(m[1]));
}

/** All the text of a request's system and user content, for finding passages. */
export function promptText(p: Req): string {
  const sys = p.system;
  const s = typeof sys === "string" ? sys : Array.isArray(sys) ? sys.map((b) => (b as { text: string }).text).join("\n") : "";
  const msgs = (p.messages as { content: unknown }[]) ?? [];
  return [s, ...msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))].join("\n");
}
