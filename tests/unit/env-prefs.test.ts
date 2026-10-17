/**
 * D5 · Appearance preferences: defaults, invalid stored values fall back to the defaults, and storage that is missing
 * or throws never crashes the page. The boot script follows the same rules.
 * Design rebuild D1: the theme (Iris default, Mono), Frosted as the default glass (Owner decision 3), and
 * html[data-reduced] set before first paint. Saved D5 values keep working unchanged.
 * Design rebuild D2: the effects preference ("auto" default, or "full") and html[data-lite] set before first paint.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULTS, isLite, isLiteDevice, isReduced, KEYS, MOTION_LABEL, prefsBootScript, readPrefs, writePref } from "@/app/env/prefs";

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("D5 · appearance preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Alpine lake, Frosted glass, full motion, the Iris theme and automatic effects", () => {
    expect(DEFAULTS).toEqual({ scene: "lake", glass: "frost", motion: "full", theme: "iris", effects: "auto" });
    expect(readPrefs(mem())).toEqual(DEFAULTS);
    expect(readPrefs(null)).toEqual(DEFAULTS);
  });

  it("reads valid saved values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "reef", [KEYS.glass]: "frost", [KEYS.motion]: "off" }))).toEqual({ scene: "reef", glass: "frost", motion: "off", theme: "iris", effects: "auto" });
    expect(readPrefs(mem({ [KEYS.scene]: "hall" })).scene).toBe("hall");
    // A D5 visitor who chose Liquid keeps it; the new theme key reads too.
    expect(readPrefs(mem({ [KEYS.glass]: "liquid", [KEYS.motion]: "simple", [KEYS.theme]: "mono", [KEYS.effects]: "full" }))).toEqual({ scene: "lake", glass: "liquid", motion: "simple", theme: "mono", effects: "full" });
  });

  it("falls back to the defaults for invalid stored values", () => {
    expect(readPrefs(mem({ [KEYS.scene]: "ocean", [KEYS.glass]: "<script>", [KEYS.motion]: "FULL", [KEYS.theme]: "dark", [KEYS.effects]: "max" }))).toEqual(DEFAULTS);
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

  it("Lite: phone-width screens, 4 or fewer cores or Save-Data, unless the person chose full effects", () => {
    expect(isLiteDevice({ width: 1440, cores: 8 })).toBe(false);
    expect(isLiteDevice({ width: 390, cores: 8 })).toBe(true);
    expect(isLiteDevice({ width: 1440, cores: 4 })).toBe(true);
    expect(isLiteDevice({ width: 1440, cores: 8, saveData: true })).toBe(true);
    expect(isLite("auto", { width: 390 })).toBe(true);
    expect(isLite("full", { width: 390, cores: 2, saveData: true })).toBe(false);
  });

  it("the boot script applies the same rules before first paint", () => {
    const attrs: Record<string, string> = {};
    const run = (store: Record<string, string> | "throw", osReduce?: boolean, device = { width: 1440, cores: 8 }) => {
      vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } });
      vi.stubGlobal("innerWidth", device.width);
      vi.stubGlobal("navigator", { hardwareConcurrency: device.cores });
      vi.stubGlobal("localStorage", store === "throw" ? { getItem: () => { throw new Error("x"); } } : { getItem: (k: string) => store[k] ?? null });
      vi.stubGlobal("matchMedia", osReduce === undefined ? undefined : () => ({ matches: osReduce }));
      new Function(prefsBootScript())();
    };
    run({ [KEYS.scene]: "sun", [KEYS.glass]: "nope" });
    expect(attrs).toEqual({ "data-scene": "sun", "data-glass": "frost", "data-motion": "full", "data-theme": "iris", "data-effects": "auto", "data-reduced": "0", "data-lite": "0" });
    run("throw");
    expect(attrs).toEqual({ "data-scene": "lake", "data-glass": "frost", "data-motion": "full", "data-theme": "iris", "data-effects": "auto", "data-reduced": "0", "data-lite": "0" });
    run({ [KEYS.motion]: "simple", [KEYS.theme]: "mono", [KEYS.glass]: "liquid" });
    expect(attrs).toEqual({ "data-scene": "lake", "data-glass": "liquid", "data-motion": "simple", "data-theme": "mono", "data-effects": "auto", "data-reduced": "1", "data-lite": "0" });
    // Lite, before first paint: a phone, or few cores; "full" effects override it.
    run({}, undefined, { width: 390, cores: 8 });
    expect(attrs["data-lite"]).toBe("1");
    run({}, undefined, { width: 1440, cores: 2 });
    expect(attrs["data-lite"]).toBe("1");
    run({ [KEYS.effects]: "full" }, undefined, { width: 390, cores: 2 });
    expect(attrs["data-lite"]).toBe("0");
    run({}, true); // the device asks for reduced motion: always respected
    expect(attrs["data-reduced"]).toBe("1");
    run({}, false);
    expect(attrs["data-reduced"]).toBe("0");
  });
});
