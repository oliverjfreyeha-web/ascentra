/**
 * Design rebuild D2 · Small interface sounds (soft keyboard-style clicks, and a reward chime), made live with Web Audio:
 * no audio files. Based on design-reference/src/audio.js.
 *
 * Rules: off unless the person turns UI sounds on. Never autoplays: nothing is created or played until the page has
 * had a real press (pointer or key), and then only in answer to an action. Separate from the Motion setting (a person
 * can have sound with no motion, or motion with no sound). The switch is stored in the app's existing sound preference
 * (localStorage "ascentra.sound", field "effects"), which the ambient player (./engine.ts) keeps intact.
 */
import { PREFS_KEY } from "./engine";

export const UI_SOUNDS = ["tap", "nav", "on", "off", "add", "remove", "open", "correct", "wrong", "done"] as const;
export type UiSound = (typeof UI_SOUNDS)[number];
export const isUiSound = (v: unknown): v is UiSound => typeof v === "string" && (UI_SOUNDS as readonly string[]).includes(v);
const MASTER = 0.16;

/* Minimal Web Audio shapes, so tests can pass fakes. */
type AParam = { value: number; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown };
type ANode = { connect<T>(n: T): T };
type ASource = ANode & { start(t?: number, offset?: number, dur?: number): void; stop?(t: number): void };
type AOsc = ASource & { type: string; frequency: AParam; stop(t: number): void };
type ABuffer = { getChannelData(c: number): Float32Array };
export type ACtx = {
  currentTime: number; sampleRate: number; state: string; destination: unknown;
  resume(): Promise<unknown>;
  createGain(): ANode & { gain: AParam };
  createOscillator(): AOsc;
  createBuffer(ch: number, len: number, rate: number): ABuffer;
  createBufferSource(): ASource & { buffer: ABuffer | null };
  createBiquadFilter(): ANode & { type: string; frequency: AParam; Q: AParam };
};
export type UiSoundDeps = {
  createContext: () => ACtx | null;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  random: () => number;
};

export class UiSounds {
  private ctx: ACtx | null = null;
  private unlocked = false;
  private listeners = new Set<() => void>();
  constructor(private deps: UiSoundDeps) {}

  /** Whether the person turned UI sounds on (default off). */
  get enabled(): boolean {
    try { return (JSON.parse(this.deps.storage?.getItem(PREFS_KEY) ?? "{}") as { effects?: unknown }).effects === true; } catch { return false; }
  }
  setEnabled(on: boolean) {
    try {
      let saved: Record<string, unknown> = {};
      try { saved = JSON.parse(this.deps.storage?.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>; } catch { saved = {}; }
      this.deps.storage?.setItem(PREFS_KEY, JSON.stringify({ ...saved, effects: on }));
    } catch { /* not remembered */ }
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  /** Called on the page's first real press (pointer or key). Until then nothing can play. */
  unlock() { this.unlocked = true; }
  get isUnlocked() { return this.unlocked; }
  /** Whether any audio has been created yet. */
  get started() { return this.ctx !== null; }

  private context(): ACtx | null {
    if (!this.enabled || !this.unlocked) return null;
    if (!this.ctx) this.ctx = this.deps.createContext();
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Plays one small sound; returns whether it played. */
  play(name: UiSound): boolean {
    const c = this.context();
    if (!c) return false;
    try {
      const t = c.currentTime + 0.005, out = c.createGain();
      out.gain.value = MASTER;
      out.connect(c.destination);
      const j = 1 + (this.deps.random() - 0.5) * 0.06; // a tiny variation, so repeats don't sound robotic
      const k = (dt: number, o: ClickOpts) => this.click(c, out, t + dt, o);
      switch (name) {
        case "tap": k(0, { f: 2300 * j, body: 190 }); break;
        case "nav": k(0, { f: 1900 * j, body: 150, vol: 1.1 }); break;
        case "on": k(0, { f: 2600 * j, body: 210 }); k(0.045, { f: 3000 * j, body: 240, vol: 0.6 }); break;
        case "off": k(0, { f: 1700 * j, body: 140 }); k(0.045, { f: 1400 * j, body: 120, vol: 0.6 }); break;
        case "add": k(0, { f: 2400 * j, body: 200 }); k(0.06, { f: 2900 * j, body: 230, vol: 0.8 }); break;
        case "remove": k(0, { f: 1500 * j, body: 130, vol: 0.9 }); break;
        case "open": k(0, { f: 1600 * j, body: 120, vol: 1.1, dur: 0.04 }); break;
        case "correct": k(0, { f: 2800 * j, body: 260 }); k(0.07, { f: 3200 * j, body: 300, vol: 0.8 }); break;
        case "wrong": k(0, { f: 900 * j, q: 0.8, body: 100, vol: 1.1, dur: 0.05 }); break;
        case "done": [0, 0.06, 0.12].forEach((d, i) => k(d, { f: (2200 + i * 350) * j, body: 200 + i * 30, vol: 0.8 })); break;
      }
      return true;
    } catch { return false; }
  }

  /** The reward sound: only when a reward is claimed. Soft, rising pentatonic chimes over a low swell. */
  reward(): boolean {
    const c = this.context();
    if (!c) return false;
    try {
      const t0 = c.currentTime + 0.02, out = c.createGain();
      out.gain.value = 0.35;
      out.connect(c.destination);
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + 0.7);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.6, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
      o.connect(g).connect(out); o.start(t0); o.stop(t0 + 1);
      [659.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98].forEach((fr, i) => {
        const tt = t0 + 0.28 + i * 0.09, ch = c.createOscillator(), cg = c.createGain();
        ch.type = "triangle"; ch.frequency.setValueAtTime(fr, tt);
        cg.gain.setValueAtTime(0, tt); cg.gain.linearRampToValueAtTime(0.22, tt + 0.01); cg.gain.exponentialRampToValueAtTime(0.001, tt + 1.1);
        ch.connect(cg).connect(out); ch.start(tt); ch.stop(tt + 1.2);
      });
      return true;
    } catch { return false; }
  }

  /** A soft keyboard-style click: a tiny filtered noise tick plus a short low "thock". */
  private click(c: ACtx, out: ANode, t: number, { f = 2200, q = 1.1, body = 180, vol = 1, dur = 0.028 }: ClickOpts) {
    const len = Math.floor(c.sampleRate * 0.06), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.deps.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * dur * 0.4));
    const n = c.createBufferSource(); n.buffer = b;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
    const g = c.createGain(); g.gain.value = 0.9 * vol;
    n.connect(bp).connect(g).connect(out); n.start(t);
    const o = c.createOscillator(), og = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(body, t); o.frequency.exponentialRampToValueAtTime(body * 0.6, t + 0.045);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.35 * vol, t + 0.003); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.07);
  }
}
type ClickOpts = { f?: number; q?: number; body?: number; vol?: number; dur?: number };

let shared: UiSounds | null = null;
/** The page's one instance (browser only). */
export function uiSounds(): UiSounds | null {
  if (typeof window === "undefined") return null;
  if (!shared) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let storage: UiSoundDeps["storage"] = null;
    try { storage = window.localStorage; } catch { storage = null; }
    shared = new UiSounds({ createContext: () => (AC ? (new AC() as unknown as ACtx) : null), storage, random: Math.random });
  }
  return shared;
}
