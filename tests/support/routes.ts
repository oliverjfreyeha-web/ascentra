import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every /api/v1 route handler, read from the code: the file, the HTTP method, the capability it asks
 * withCap for, and a sample URL and params. A new route is picked up without editing any test.
 */
export type RouteHandler = { file: string; method: string; action: string; url: string; params: Record<string, string>; module: string };

const API_ROOT = "app/api/v1";
const PUBLIC = new Set(["app/api/v1/health/route.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /^route\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Sample values for dynamic segments: well-formed ids that exist nowhere. */
const SAMPLE: Record<string, string> = {
  id: "00000000-0000-4000-8000-00000000f00d",
  accountId: "00000000-0000-4000-8000-00000000f00e",
  deviceId: "00000000-0000-4000-8000-00000000f00f",
};

export function apiHandlers(): RouteHandler[] {
  const out: RouteHandler[] = [];
  for (const file of files(API_ROOT).filter((f) => !PUBLIC.has(f)).sort()) {
    const src = readFileSync(file, "utf8");
    const params: Record<string, string> = {};
    const path = relative("app", file).replace(/\/route\.tsx?$/, "").split("/").map((seg) => {
      const m = seg.match(/^\[(\w+)\]$/);
      if (!m) return seg;
      params[m[1]] = SAMPLE[m[1]] ?? `sample-${m[1]}`;
      return params[m[1]];
    }).join("/");
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b([^\n]*)/g)];
    for (const m of exported) {
      const action = m[2].match(/withCap\(\s*"([^"]+)"/)?.[1];
      if (!action) throw new Error(`${file} ${m[1]} isn't exported through withCap("<capability>", ...)`);
      out.push({ file, method: m[1], action, url: `http://localhost/${path}`, params, module: `@/${file.replace(/\.tsx?$/, "")}` });
    }
  }
  return out;
}
