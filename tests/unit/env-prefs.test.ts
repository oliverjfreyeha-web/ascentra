/**
 * D5 · Appearance preferences: defaults, invalid stored values fall back to the defaults, and storage that is missing
 * or throws never crashes the page. The boot script follows the same rules.
 * Design rebuild D1: the theme (Iris default, Mono), Frosted as the default glass (Owner decision 3), and
 * html[data-reduced] set before first paint. Saved D5 values keep working unchanged.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULTS, isReduced, KEYS, MOTION_LABEL, prefsBootScript, readPrefs, writePref } from "@/app/env/prefs";

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("D5 · appearance preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Alpine lake, Frosted glass, full motion and the Iris theme", () => {
    expect(DEFAULTS).toEqual({ scene: "lake", glass: "frost", motion: "full", theme: "iris" });
    expect(readPrefs(mem())).toEqual(DEFAULTS);
    expect(readPrefs(null)).toEqual(DEFAULTS);
  });

  it("reads valid saved values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "reef", [KEYS.glass]: "frost", [KEYS.motion]: "off" }))).toEqual({ scene: "reef", glass: "frost", motion: "off", theme: "iris" });
    expect(readPrefs(mem({ [KEYS.scene]: "hall" })).scene).toBe("hall");
    // A D5 visitor who chose Liquid keeps it; the new theme key reads too.
    expect(readPrefs(mem({ [KEYS.glass]: "liquid", [KEYS.motion]: "simple", [KEYS.theme]: "mono" }))).toEqual({ scene: "lake", glass: "liquid", motion: "simple", theme: "mono" });
  });

  it("falls back to the defaults for invalid stored values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "ocean", [KEYS.glass]: "<script>", [KEYS.motion]: "FULL", [KEYS.theme]: "dark" }))).toEqual(DEFAULTS);
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
    expect(writePref("theme", "mono", s)).toBe(true);
    expect(s.m.get(KEYS.theme)).toBe("mono");
    expect(writePref("theme", "light" as never, s)).toBe(false);
  });

  it("motion is reduced unless it is Full and neither the device nor a slow-device check asks for less", () => {
    expect(isReduced("full", false)).toBe(false);
    expect(isReduced("simple", false)).toBe(true);
    expect(isReduced("off", false)).toBe(true);
    expect(isReduced("full", true)).toBe(true);
    expect(isReduced("full", false, true)).toBe(true);
    // Shown to people as "Reduced"; the stored value stays "simple".
    expect(MOTION_LABEL.simple).toBe("Reduced");
  });

  it("the boot script applies the same rules before first paint", () => {
    const attrs: Record<string, string> = {};
    const run = (store: Record<string, string> | "throw", osReduce?: boolean) => {
      vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } });
      vi.stubGlobal("localStorage", store === "throw" ? { getItem: () => { throw new Error("x"); } } : { getItem: (k: string) => store[k] ?? null });
      vi.stubGlobal("matchMedia", osReduce === undefined ? undefined : () => ({ matches: osReduce }));
      new Function(prefsBootScript())();
    };
    run({ [KEYS.scene]: "sun", [KEYS.glass]: "nope" });
    expect(attrs).toEqual({ "data-scene": "sun", "data-glass": "frost", "data-motion": "full", "data-theme": "iris", "data-reduced": "0" });
    run("throw");
    expect(attrs).toEqual({ "data-scene": "lake", "data-glass": "frost", "data-motion": "full", "data-theme": "iris", "data-reduced": "0" });
    run({ [KEYS.motion]: "simple", [KEYS.theme]: "mono", [KEYS.glass]: "liquid" });
    expect(attrs).toEqual({ "data-scene": "lake", "data-glass": "liquid", "data-motion": "simple", "data-theme": "mono", "data-reduced": "1" });
    run({}, true); // the device asks for reduced motion: always respected
    expect(attrs["data-reduced"]).toBe("1");
    run({}, false);
    expect(attrs["data-reduced"]).toBe("0");
  });
});
