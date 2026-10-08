/**
 * D5 · Appearance preferences: defaults, invalid stored values fall back to the defaults, and storage that is missing
 * or throws never crashes the page. The boot script follows the same rules.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULTS, KEYS, prefsBootScript, readPrefs, writePref } from "@/app/env/prefs";

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("D5 · appearance preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Alpine lake, Liquid glass and full motion", () => {
    expect(DEFAULTS).toEqual({ scene: "lake", glass: "liquid", motion: "full" });
    expect(readPrefs(mem())).toEqual(DEFAULTS);
    expect(readPrefs(null)).toEqual(DEFAULTS);
  });

  it("reads valid saved values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "reef", [KEYS.glass]: "frost", [KEYS.motion]: "off" }))).toEqual({ scene: "reef", glass: "frost", motion: "off" });
    expect(readPrefs(mem({ [KEYS.scene]: "hall" })).scene).toBe("hall");
  });

  it("falls back to the defaults for invalid stored values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "ocean", [KEYS.glass]: "<script>", [KEYS.motion]: "FULL" }))).toEqual(DEFAULTS);
  });

  it("never crashes when storage throws or is missing", () => {
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readPrefs(boom)).toEqual(DEFAULTS);
    expect(writePref("scene", "reef", boom)).toBe(false);
    expect(writePref("scene", "reef", null)).toBe(false);
    vi.stubGlobal("window", { get localStorage() { throw new Error("SecurityError"); } });
    expect(readPrefs()).toEqual(DEFAULTS);
    expect(writePref("glass", "frost")).toBe(false);
  });

  it("only writes allowed values", () => {
    const s = mem();
    expect(writePref("glass", "frost", s)).toBe(true);
    expect(s.m.get(KEYS.glass)).toBe("frost");
    expect(writePref("motion", "turbo" as never, s)).toBe(false);
    expect(s.m.has(KEYS.motion)).toBe(false);
  });

  it("the boot script applies the same rules before first paint", () => {
    const attrs: Record<string, string> = {};
    const run = (store: Record<string, string> | "throw") => {
      vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } });
      vi.stubGlobal("localStorage", store === "throw" ? { getItem: () => { throw new Error("x"); } } : { getItem: (k: string) => store[k] ?? null });
      new Function(prefsBootScript())();
    };
    run({ [KEYS.scene]: "sun", [KEYS.glass]: "nope" });
    expect(attrs).toEqual({ "data-scene": "sun", "data-glass": "liquid", "data-motion": "full" });
    run("throw");
    expect(attrs).toEqual({ "data-scene": "lake", "data-glass": "liquid", "data-motion": "full" });
  });
});
