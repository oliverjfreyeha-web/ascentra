/**
 * Design rebuild D2 · UI sounds: off by default; nothing is created or played before a real press; plays only when on;
 * the switch lives in the existing sound preference and survives the ambient player saving its own settings; it is
 * independent of motion.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PREFS_KEY, SoundEngine, type EngineDeps } from "@/app/ui/sound/engine";
import { UiSounds, type ACtx, type UiSoundDeps } from "@/app/ui/sound/ui-sounds";

function fakeCtx() {
  const p = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect<T>(n: T) { return n; } });
  let started = 0;
  const ctx: ACtx = {
    currentTime: 0, sampleRate: 8000, state: "running", destination: {},
    resume: async () => {},
    createGain: () => ({ ...node(), gain: p() }),
    createOscillator: () => ({ ...node(), type: "", frequency: p(), start: () => { started++; }, stop() {} }),
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ ...node(), buffer: null, start: () => { started++; } }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: p(), Q: p() }),
  };
  return { ctx, started: () => started };
}
function setup(saved?: Record<string, unknown>) {
  const store = new Map<string, string>();
  if (saved) store.set(PREFS_KEY, JSON.stringify(saved));
  const f = fakeCtx();
  let contexts = 0;
  const deps: UiSoundDeps = {
    createContext: () => { contexts++; return f.ctx; },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    random: () => 0.5,
  };
  return { s: new UiSounds(deps), store, contexts: () => contexts, started: f.started };
}

describe("D2 · UI sounds", () => {
  it("are off by default, and then nothing is created or played, even after a press", () => {
    const { s, contexts } = setup();
    expect(s.enabled).toBe(false);
    s.unlock();
    expect(s.play("tap")).toBe(false);
    expect(s.reward()).toBe(false);
    expect(contexts()).toBe(0);
  });

  it("never play before the page's first real press, even when on", () => {
    const { s, contexts } = setup({ effects: true });
    expect(s.enabled).toBe(true);
    expect(s.play("tap")).toBe(false);
    expect(contexts()).toBe(0);
    s.unlock();
    expect(s.play("tap")).toBe(true);
    expect(s.reward()).toBe(true);
    expect(contexts()).toBe(1); // one shared context
  });

  it("play each named sound once on, and nothing once turned off again", () => {
    const { s, started } = setup({ effects: true });
    s.unlock();
    for (const n of ["tap", "nav", "on", "off", "add", "remove", "open", "correct", "wrong", "done"] as const) expect(s.play(n), n).toBe(true);
    const before = started();
    s.setEnabled(false);
    expect(s.play("tap")).toBe(false);
    expect(started()).toBe(before);
  });

  it("store the switch in the existing sound preference, keeping the ambient player's settings", () => {
    const { s, store } = setup({ track: "night", volume: 40, shuffle: true, loop: false });
    s.setEnabled(true);
    expect(JSON.parse(store.get(PREFS_KEY)!)).toEqual({ track: "night", volume: 40, shuffle: true, loop: false, effects: true });
  });

  it("the ambient player keeps the switch when it saves its own settings", () => {
    const store = new Map<string, string>([[PREFS_KEY, JSON.stringify({ track: "calm", volume: 35, shuffle: false, loop: true, effects: true })]]);
    const deps = {
      createAudio: () => { throw new Error("no audio in this test"); },
      createContext: () => null,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      mediaSession: null, createMetadata: null, setTimeout: () => 0, random: () => 0,
    } as unknown as EngineDeps;
    new SoundEngine(deps).setVolume(50);
    expect(JSON.parse(store.get(PREFS_KEY)!)).toMatchObject({ volume: 50, effects: true });
  });

  it("are independent of motion: the module never reads the Motion setting", () => {
    const src = readFileSync("app/ui/sound/ui-sounds.ts", "utf8") + readFileSync("app/ui/sound/ui-sound-clicks.tsx", "utf8");
    expect(src).not.toMatch(/data-reduced|data-motion|prefers-reduced-motion/);
  });
});
