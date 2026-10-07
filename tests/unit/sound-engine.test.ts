/**
 * D2e: the persistent ambient player. Nothing autoplays; a saved choice never turns it on; it survives navigation
 * (it lives in the root layout, not in a page) and keeps playing when the tab is hidden; it crossfades, prefetches the
 * next track only after 30 s, ducks for other audio and resumes only if it was playing; Media Session controls work.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CROSSFADE_S, PREFS_KEY, SoundEngine, type EngineDeps } from "@/app/ui/sound/engine";
import { TRACKS } from "@/app/ui/sound/tracks";

class FakeParam {
  value = 0;
  target = 0;
  cancelScheduledValues() {}
  setValueAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.target = v; }
}
class FakeAudio {
  src = ""; preload = ""; loop = false; currentTime = 0; duration = NaN; paused = true; volume = 1; plays = 0;
  private handlers: Record<string, (() => void)[]> = {};
  play() { this.paused = false; this.plays++; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  addEventListener(type: string, fn: () => void) { (this.handlers[type] ??= []).push(fn); }
  emit(type: string) { (this.handlers[type] ?? []).forEach((f) => f()); }
}
function setup(saved?: Record<string, unknown>, oldOn = false) {
  const audios: FakeAudio[] = [];
  const store = new Map<string, string>();
  if (saved) store.set(PREFS_KEY, JSON.stringify(saved));
  if (oldOn) store.set("ascentra.ambient", "on");
  const handlers: Record<string, () => void> = {};
  const session = { metadata: null as unknown, playbackState: "none", setActionHandler: (a: string, fn: (() => void) | null) => { if (fn) handlers[a] = fn; } };
  const ctx = {
    currentTime: 0, state: "running", destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ gain: new FakeParam(), connect: (n: unknown) => n }),
    createMediaElementSource: () => ({ connect: (n: unknown) => n }),
  };
  let contexts = 0;
  const deps: EngineDeps = {
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never; },
    createContext: () => { contexts++; return ctx as never; },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    mediaSession: session,
    createMetadata: (m) => m,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    random: () => 0,
  };
  return { engine: new SoundEngine(deps), audios, store, session, handlers, contexts: () => contexts };
}

beforeEach(() => { vi.useRealTimers(); });

describe("D2e: nothing autoplays, and the saved choice never turns it on", () => {
  it("a new engine is off and creates no audio, no audio context and no media controls", () => {
    const { engine, audios, contexts, session } = setup();
    expect(engine.getState().on).toBe(false);
    expect(audios).toHaveLength(0);
    expect(contexts()).toBe(0);
    expect(session.metadata).toBeNull();
  });

  it("a saved track and volume are restored, but never 'on' (even the old D2c 'on' flag is dropped)", () => {
    const { engine, audios, store } = setup({ track: "night", volume: 60, on: true, shuffle: true, loop: false }, true);
    expect(engine.getState()).toMatchObject({ on: false, trackId: "night", volume: 60, shuffle: true, loop: false });
    expect(audios).toHaveLength(0);
    expect(store.has("ascentra.ambient")).toBe(false);
    engine.setVolume(40);
    expect(JSON.parse(store.get(PREFS_KEY)!)).toEqual({ track: "night", volume: 40, shuffle: true, loop: false });
  });

  it("choosing a track, next or previous while off only selects; nothing plays", () => {
    const { engine, audios } = setup();
    engine.select("focus"); engine.next(); engine.previous();
    expect(engine.getState().on).toBe(false);
    expect(audios.every((a) => a.paused && a.plays === 0)).toBe(true);
  });

  it("only a press starts it, loading only the chosen track", async () => {
    const { engine, audios } = setup({ track: "deep-study" });
    await engine.play();
    expect(engine.getState().on).toBe(true);
    const playing = audios.filter((a) => !a.paused);
    expect(playing).toHaveLength(1);
    expect(playing[0].src).toBe("/audio/deep-study.mp3");
    expect(audios.filter((a) => a.src).length).toBe(1); // the other deck has nothing loaded
  });
});

describe("D2e: it keeps playing", () => {
  it("lives in the root layout, outside every page, so navigation does not unmount it", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/<SoundProvider>[\s\S]*<DeviceGate>\{children\}<\/DeviceGate>[\s\S]*<\/SoundProvider>/);
    const footer = readFileSync("app/ui/site-footer.tsx", "utf8") + readFileSync("app/ui/ambient-sound.tsx", "utf8");
    expect(footer).not.toMatch(/new (Audio|AudioContext)|SoundEngine\(/); // pages only hold controls, never the player
    expect(readFileSync("app/ui/sound/sound-provider.tsx", "utf8")).toMatch(/new SoundEngine\(browserDeps\(\)\)/);
  });

  it("does not pause when the tab is hidden (no visibility handling at all)", () => {
    for (const f of ["app/ui/sound/engine.ts", "app/ui/sound/sound-provider.tsx", "app/ui/ambient-sound.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/visibilitychange|visibilityState|document\.hidden/);
    }
  });

  it("in-app links use client-side navigation (no plain <a href=\"/…\"> to app pages)", () => {
    const hits = execSync(`grep -rln --include=*.tsx '<a href="/' app || true`, { encoding: "utf8" }).trim();
    expect(hits).toBe("");
  });
});

describe("D2e: tracks, crossfade, prefetch, ducking and media controls", () => {
  it("crossfades about 2 s to a newly chosen track while playing", async () => {
    vi.useFakeTimers();
    const { engine, audios } = setup();
    await engine.play();
    const [a, b] = audios;
    engine.select("night");
    expect(b.src).toBe("/audio/night.mp3");
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(false); // both play during the crossfade
    vi.advanceTimersByTime(CROSSFADE_S * 1000 + 100);
    expect(a.paused).toBe(true);
  });

  it("fetches the next track only after the current one has played 30 s", async () => {
    const { engine, audios } = setup({ track: "calm", loop: false });
    await engine.play();
    const [a, b] = audios;
    a.duration = 58; a.currentTime = 29; a.emit("timeupdate");
    expect(b.src).toBe("");
    a.currentTime = 30.2; a.emit("timeupdate");
    expect(b.src).toBe("/audio/focus.mp3");
    expect(b.paused).toBe(true); // fetched, not played
  });

  it("loops seamlessly: near the end it crossfades into a fresh copy of the same track", async () => {
    const { engine, audios } = setup({ track: "calm", loop: true });
    await engine.play();
    const [a, b] = audios;
    a.duration = 58; a.currentTime = 56.5; a.emit("timeupdate");
    expect(b.src).toBe("/audio/ambient-loop.mp3");
    expect(b.paused).toBe(false);
    expect(engine.getState().trackId).toBe("calm");
  });

  it("pauses for a video or the Mentor speaking, and resumes after only if it was playing", async () => {
    vi.useFakeTimers();
    const { engine, audios } = setup();
    engine.duck("video"); engine.unduck("video");
    expect(engine.getState().on).toBe(false); // was off: stays off
    await engine.play();
    engine.duck("video");
    expect(engine.getState()).toMatchObject({ on: true, ducked: true });
    vi.advanceTimersByTime(1000);
    expect(audios[0].paused).toBe(true);
    engine.unduck("video");
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.getState().ducked).toBe(false);
    expect(audios[0].paused).toBe(false);
  });

  it("Media Session shows the track and its play, pause, next and previous controls work", async () => {
    const { engine, session, handlers } = setup();
    await engine.play();
    expect(session.metadata).toMatchObject({ title: "Calm", artist: "ASCENTRA ambient sound" });
    expect(session.playbackState).toBe("playing");
    handlers.nexttrack();
    expect(engine.getState().trackId).toBe("focus");
    expect(session.metadata).toMatchObject({ title: "Focus" });
    handlers.previoustrack();
    expect(engine.getState().trackId).toBe("calm");
    handlers.pause();
    expect(session.playbackState).toBe("paused");
    expect(engine.getState().on).toBe(false);
  });

  it("every track has a title, mood, a 96 kbps file under 900 KB, its source tool and an AI label", () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(4);
    for (const t of TRACKS) {
      expect(t.title && t.mood && t.tool && t.aiLabel).toBeTruthy();
      expect(t.aiLabel).toMatch(/AI/);
      expect(statSync(`public${t.file}`).size).toBeLessThan(900 * 1024);
    }
    const credits = readFileSync("app/credits/page.tsx", "utf8");
    expect(credits).toMatch(/TRACKS\.map/);
    expect(credits).toMatch(/t\.aiLabel/);
    const doc = readFileSync("docs/design/ASSETS.md", "utf8");
    for (const f of ["focus.mp3", "deep-study.mp3", "night.mp3"]) expect(doc).toContain(f);
  });
});
