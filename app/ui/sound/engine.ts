/**
 * D2e · The ambient sound engine: one per page load, owned by <SoundProvider> in the root layout, so it survives
 * client-side navigation between screens. Plain TypeScript (no React) so it can be tested with fake audio.
 *
 * Locked rules: nothing plays until a person presses play (or a media key, which is also a press). The engine never
 * starts itself: not on load, not after navigating, not after a reload. It remembers the chosen track, volume, shuffle
 * and loop in this browser, but never "on". It keeps playing in a background tab until the person turns it off.
 *
 * How it plays: two "decks" (audio elements) routed through Web Audio gains. Switching tracks crossfades over ~2 s;
 * a looping track crossfades into a fresh copy of itself near its end, so the loop has no gap. Only the chosen track
 * is loaded; the next one is fetched only after the current one has played for 30 s.
 */
import { DEFAULT_TRACK, TRACKS, trackById, type Track } from "./tracks";

export type SoundState = {
  on: boolean;          // the person has it playing (stays true while ducked)
  ducked: boolean;      // paused for another sound (a lesson video, the Mentor speaking); resumes after
  trackId: string;
  volume: number;       // 0..100
  shuffle: boolean;
  loop: boolean;        // repeat the current track (otherwise move on to the next)
};

type Param = { value: number; cancelScheduledValues(t: number): unknown; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown };
type Gain = { gain: Param; connect(n: unknown): unknown };
type Ctx = { currentTime: number; state: string; destination: unknown; resume(): Promise<unknown>; createGain(): Gain; createMediaElementSource(el: Audio): { connect(n: unknown): unknown } };
type Audio = {
  src: string; preload: string; loop: boolean; currentTime: number; duration: number; paused: boolean; volume: number;
  play(): Promise<unknown>; pause(): void; load(): void;
  addEventListener(type: string, fn: () => void): void;
};
type MediaSessionLike = {
  metadata: unknown; playbackState: string;
  setActionHandler(action: string, fn: (() => void) | null): void;
};
export type EngineDeps = {
  createAudio: () => Audio;
  createContext: () => Ctx | null;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  mediaSession: MediaSessionLike | null;
  createMetadata: ((m: { title: string; artist: string; album: string; artwork: { src: string; sizes: string; type: string }[] }) => unknown) | null;
  setTimeout: (fn: () => void, ms: number) => unknown;
  random: () => number;
};

export const PREFS_KEY = "ascentra.sound";
const OLD_KEY = "ascentra.ambient"; // D2c stored "on"/"off"; it is removed so "on" is never remembered
export const CROSSFADE_S = 2;
export const FADE_IN_S = 1.6;
export const FADE_OUT_S = 0.6;
export const PREFETCH_AFTER_S = 30;
const MAX_GAIN = 0.6; // the slider's 100%: still a background level
export const DEFAULT_VOLUME = 35;

type Deck = { audio: Audio; gain: Gain | null; trackId: string | null };

export class SoundEngine {
  private state: SoundState;
  private listeners = new Set<() => void>();
  private ctx: Ctx | null = null;
  private master: Gain | null = null;
  private decks: [Deck, Deck] | null = null;
  private live = 0;                     // index of the deck that is playing
  private queued: string | null = null; // the next track, once chosen (after 30 s)
  private fading = false;
  private duckers = new Set<unknown>();
  private sessionReady = false;
  private history: string[] = [];

  constructor(private deps: EngineDeps) {
    const saved = this.readPrefs();
    this.state = { on: false, ducked: false, trackId: saved.trackId, volume: saved.volume, shuffle: saved.shuffle, loop: saved.loop };
  }

  // ── store (for useSyncExternalStore) ──
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<SoundState>) {
    this.state = { ...this.state, ...patch };
    this.writePrefs();
    this.updateSession();
    this.listeners.forEach((fn) => fn());
  }

  get track(): Track { return trackById(this.state.trackId); }
  /** Whether any audio has been created yet (nothing is, until the first press). */
  get started() { return this.decks !== null; }

  // ── controls: each one is called from a press (a button, a key, or a media key) ──
  async play() {
    if (this.state.on && !this.state.ducked) return;
    this.set({ on: true });
    if (this.duckers.size) { this.set({ ducked: true }); return; }
    await this.resumeAudio();
  }
  pause() {
    if (!this.state.on) return;
    this.set({ on: false, ducked: false });
    this.fadeOutLive();
  }
  toggle() { return this.state.on ? this.pause() : this.play(); }

  /** Choose a track. While playing, crossfade to it; while off, only select it (it never starts by itself). */
  select(id: string, remember = true) {
    if (!TRACKS.some((t) => t.id === id) || id === this.state.trackId) return;
    if (remember) this.history.push(this.state.trackId);
    this.set({ trackId: id });
    this.queued = null;
    if (this.state.on && !this.state.ducked && this.decks) this.crossfadeTo(id);
  }
  next() { this.select(this.pickNext()); }
  /** The track played before this one, or else the one above it in the list. */
  previous() {
    const i = TRACKS.findIndex((t) => t.id === this.state.trackId);
    this.select(this.history.pop() ?? TRACKS[(i - 1 + TRACKS.length) % TRACKS.length].id, false);
  }
  setVolume(v: number) {
    const volume = Math.max(0, Math.min(100, Math.round(v)));
    this.set({ volume });
    if (this.master && this.ctx) this.ramp(this.master.gain, this.gainFor(volume), 0.08);
    else if (this.decks) this.decks[this.live].audio.volume = this.gainFor(volume);
  }
  setShuffle(shuffle: boolean) { this.set({ shuffle }); this.queued = null; }
  setLoop(loop: boolean) { this.set({ loop }); this.queued = null; }

  // ── ducking: another sound (a lesson video, the Mentor speaking) pauses the music, which resumes afterward only
  // if it was playing before ──
  duck(source: unknown) {
    this.duckers.add(source);
    if (this.state.on && !this.state.ducked) { this.set({ ducked: true }); this.fadeOutLive(); }
  }
  unduck(source: unknown) {
    if (!this.duckers.delete(source) || this.duckers.size) return;
    if (this.state.on && this.state.ducked) { this.set({ ducked: false }); void this.resumeAudio(); }
  }

  // ── audio ──
  private gainFor(volume: number) { return (volume / 100) * MAX_GAIN; }

  private setup() {
    if (this.decks) return;
    let ctx: Ctx | null = null;
    try { ctx = this.deps.createContext(); } catch { ctx = null; }
    const mk = (): Deck => {
      const audio = this.deps.createAudio();
      audio.preload = "none";
      audio.loop = false;
      let gain: Gain | null = null;
      if (ctx) {
        try {
          gain = ctx.createGain();
          gain.gain.value = 0;
          ctx.createMediaElementSource(audio).connect(gain);
        } catch { gain = null; }
      }
      const deck: Deck = { audio, gain, trackId: null };
      audio.addEventListener("timeupdate", () => this.onTime(deck));
      audio.addEventListener("ended", () => this.onEnded(deck));
      return deck;
    };
    const a = mk(), b = mk();
    if (ctx && a.gain && b.gain) {
      this.master = ctx.createGain();
      this.master.gain.value = this.gainFor(this.state.volume);
      a.gain.connect(this.master); b.gain.connect(this.master);
      this.master.connect(ctx.destination);
      this.ctx = ctx;
    } else {
      // No Web Audio: plain elements, no crossfade; the browser's own loop keeps it seamless enough.
      this.ctx = null;
      a.gain = b.gain = null;
    }
    this.decks = [a, b];
  }

  private load(deck: Deck, id: string) {
    if (deck.trackId === id) return;
    deck.trackId = id;
    deck.audio.src = trackById(id).file;
    deck.audio.preload = "auto";
  }

  private async resumeAudio() {
    this.setup();
    const deck = this.decks![this.live];
    this.load(deck, this.state.trackId);
    await this.ctx?.resume().catch(() => undefined);
    if (!this.ctx) { deck.audio.loop = this.state.loop; deck.audio.volume = this.gainFor(this.state.volume); }
    await deck.audio.play().catch(() => undefined);
    if (deck.gain) this.ramp(deck.gain.gain, 1, FADE_IN_S);
    this.setupSession();
  }

  private fadeOutLive() {
    if (!this.decks) return;
    for (const deck of this.decks) {
      if (deck.audio.paused) continue;
      if (deck.gain) {
        this.ramp(deck.gain.gain, 0, FADE_OUT_S);
        this.deps.setTimeout(() => { if (!this.state.on || this.state.ducked) deck.audio.pause(); }, FADE_OUT_S * 1000 + 40);
      } else deck.audio.pause();
    }
    this.fading = false;
  }

  private crossfadeTo(id: string) {
    if (!this.decks) return;
    const from = this.decks[this.live];
    if (!this.ctx || !from.gain) {
      this.load(from, id);
      from.audio.loop = this.state.loop;
      void from.audio.play().catch(() => undefined);
      return;
    }
    const to = this.decks[1 - this.live];
    this.fading = true;
    if (to.trackId === id && to.audio.currentTime > 0) to.audio.currentTime = 0;
    this.load(to, id);
    to.gain!.gain.value = 0;
    void to.audio.play().catch(() => undefined);
    this.ramp(to.gain!.gain, 1, CROSSFADE_S);
    this.ramp(from.gain.gain, 0, CROSSFADE_S);
    this.live = 1 - this.live;
    this.queued = null;
    this.deps.setTimeout(() => {
      from.audio.pause();
      from.audio.currentTime = 0;
      this.fading = false;
    }, CROSSFADE_S * 1000 + 60);
  }

  /** Called as the live deck plays: prefetch the next track after 30 s; near the end, crossfade on. */
  private onTime(deck: Deck) {
    if (!this.decks || deck !== this.decks[this.live] || !this.state.on || this.state.ducked || !this.ctx) return;
    const t = deck.audio.currentTime, d = deck.audio.duration;
    if (t >= PREFETCH_AFTER_S && this.queued === null) {
      this.queued = this.state.loop ? this.state.trackId : this.pickNext();
      this.load(this.decks[1 - this.live], this.queued);
    }
    if (Number.isFinite(d) && d > CROSSFADE_S * 2 && d - t <= CROSSFADE_S + 0.15 && !this.fading) {
      const id = this.queued ?? (this.state.loop ? this.state.trackId : this.pickNext());
      if (id === this.state.trackId) this.crossfadeTo(id);
      else { this.history.push(this.state.trackId); this.set({ trackId: id }); this.crossfadeTo(id); }
    }
  }
  private onEnded(deck: Deck) {
    // Only without Web Audio (no crossfade): move on, or start the same track again.
    if (this.ctx || !this.decks || deck !== this.decks[this.live] || !this.state.on || this.state.ducked) return;
    if (this.state.loop) { deck.audio.currentTime = 0; void deck.audio.play().catch(() => undefined); }
    else this.next();
  }

  private pickNext(): string {
    const i = TRACKS.findIndex((t) => t.id === this.state.trackId);
    if (this.state.shuffle && TRACKS.length > 1) {
      const others = TRACKS.filter((t) => t.id !== this.state.trackId);
      return others[Math.floor(this.deps.random() * others.length) % others.length].id;
    }
    return TRACKS[(i + 1) % TRACKS.length].id;
  }

  private ramp(p: Param, to: number, seconds: number) {
    if (!this.ctx) { p.value = to; return; }
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(to, now + seconds);
  }

  // ── Media Session: the track name in the browser's and phone's media controls; media keys and lock-screen
  // controls play, pause, skip. Set up only after the first press, so nothing shows before the person starts it. ──
  private setupSession() {
    const ms = this.deps.mediaSession;
    if (!ms || this.sessionReady) { this.updateSession(); return; }
    this.sessionReady = true;
    const handlers: Record<string, () => void> = {
      play: () => void this.play(),
      pause: () => this.pause(),
      stop: () => this.pause(),
      nexttrack: () => this.next(),
      previoustrack: () => this.previous(),
    };
    for (const [action, fn] of Object.entries(handlers)) { try { ms.setActionHandler(action, fn); } catch { /* not supported here */ } }
    this.updateSession();
  }
  private updateSession() {
    const ms = this.deps.mediaSession;
    if (!ms || !this.sessionReady) return;
    const t = this.track;
    try {
      ms.metadata = this.deps.createMetadata?.({
        title: t.title, artist: "ASCENTRA ambient sound", album: `${t.mood} · ${t.aiLabel} (${t.tool})`,
        artwork: [{ src: "/art/hero-sculpture-480.webp", sizes: "480x480", type: "image/webp" }],
      }) ?? null;
      ms.playbackState = this.state.on && !this.state.ducked ? "playing" : "paused";
    } catch { /* not supported here */ }
  }

  // ── preferences: track, volume, shuffle, loop. Never "on". ──
  private readPrefs(): Omit<SoundState, "on" | "ducked"> {
    const fallback = { trackId: DEFAULT_TRACK, volume: DEFAULT_VOLUME, shuffle: false, loop: true };
    try {
      this.deps.storage?.removeItem(OLD_KEY);
      const raw = this.deps.storage?.getItem(PREFS_KEY);
      if (!raw) return fallback;
      const p = JSON.parse(raw) as Record<string, unknown>;
      return {
        trackId: typeof p.track === "string" && TRACKS.some((t) => t.id === p.track) ? p.track : fallback.trackId,
        volume: typeof p.volume === "number" && p.volume >= 0 && p.volume <= 100 ? p.volume : fallback.volume,
        shuffle: p.shuffle === true,
        loop: p.loop !== false,
      };
    } catch { return fallback; }
  }
  private writePrefs() {
    const { trackId, volume, shuffle, loop } = this.state;
    try { this.deps.storage?.setItem(PREFS_KEY, JSON.stringify({ track: trackId, volume, shuffle, loop })); } catch { /* not remembered */ }
  }
}

/** The real browser dependencies. */
export function browserDeps(): EngineDeps {
  const AC = typeof window === "undefined" ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let storage: EngineDeps["storage"] = null;
  try { storage = window.localStorage; } catch { storage = null; }
  const ms = typeof navigator !== "undefined" && "mediaSession" in navigator ? (navigator.mediaSession as unknown as MediaSessionLike) : null;
  return {
    createAudio: () => new window.Audio() as unknown as Audio,
    createContext: () => (AC ? (new AC() as unknown as Ctx) : null),
    storage,
    mediaSession: ms,
    createMetadata: typeof MediaMetadata !== "undefined" ? (m) => new MediaMetadata(m) : null,
    setTimeout: (fn, ms2) => window.setTimeout(fn, ms2),
    random: Math.random,
  };
}
