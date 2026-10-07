"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_VOLUME, SoundEngine, browserDeps, type SoundState } from "./engine";
import { DEFAULT_TRACK } from "./tracks";

/** The event another feature dispatches to pause the music while it speaks or plays (e.g. a future spoken Mentor). */
export const DUCK_EVENT = "ascentra:duck";
export type DuckDetail = { source: string; active: boolean };

const OFF: SoundState = { on: false, ducked: false, trackId: DEFAULT_TRACK, volume: DEFAULT_VOLUME, shuffle: false, loop: true };
type Ctx = { engine: SoundEngine | null; register: () => () => void };
const SoundContext = createContext<Ctx>({ engine: null, register: () => () => {} });

/**
 * D2e: the persistent ambient player. It sits in the root layout, outside every page and route segment, so client-side
 * navigation never unmounts it and the music keeps playing from screen to screen and in a background tab, until the
 * person turns it off. It never starts the music itself. It also pauses the music while a video or other audio on the
 * page plays (or while a feature signals DUCK_EVENT), resuming afterward only if it was playing before.
 * Where a page has no sound control in its footer (a lesson, say), a small dock appears while the music is on, so it
 * can always be paused from the page it is playing on.
 */
export function SoundProvider({ children }: { children: ReactNode }) {
  // Created once, after hydration (the server never has one); it creates no audio until the first press.
  const [engine, setEngine] = useState<SoundEngine | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the engine is browser-only
  useEffect(() => setEngine((e) => e ?? new SoundEngine(browserDeps())), []);
  const [controls, setControls] = useState(0);
  const register = useCallback(() => { setControls((n) => n + 1); return () => setControls((n) => n - 1); }, []);
  const ctx = useMemo<Ctx>(() => ({ engine, register }), [engine, register]);

  useEffect(() => {
    if (!engine) return;
    const isMedia = (t: EventTarget | null): t is HTMLMediaElement => t instanceof HTMLMediaElement;
    const onPlay = (e: Event) => { if (isMedia(e.target) && !e.target.muted) engine.duck(e.target); };
    const onStop = (e: Event) => { if (isMedia(e.target)) engine.unduck(e.target); };
    const onDuck = (e: Event) => {
      const d = (e as CustomEvent<DuckDetail>).detail;
      if (d && typeof d.source === "string") { if (d.active) engine.duck(d.source); else engine.unduck(d.source); }
    };
    // Media events don't bubble, so listen in the capture phase. The music's own audio elements aren't in the page.
    document.addEventListener("play", onPlay, true);
    document.addEventListener("pause", onStop, true);
    document.addEventListener("ended", onStop, true);
    document.addEventListener("emptied", onStop, true);
    window.addEventListener(DUCK_EVENT, onDuck);
    return () => {
      document.removeEventListener("play", onPlay, true);
      document.removeEventListener("pause", onStop, true);
      document.removeEventListener("ended", onStop, true);
      document.removeEventListener("emptied", onStop, true);
      window.removeEventListener(DUCK_EVENT, onDuck);
    };
  }, [engine]);

  return (
    <SoundContext.Provider value={ctx}>
      {children}
      {controls === 0 && <SoundDock />}
    </SoundContext.Provider>
  );
}

/** The engine and its live state, for the sound controls. */
export function useSound() {
  const { engine, register } = useContext(SoundContext);
  const state = useSyncExternalStore(engine?.subscribe ?? noop, engine?.getState ?? off, off);
  return { engine, state, register };
}
const noop = () => () => {};
const off = () => OFF;

/** Shown only while the music is on and the page has no footer control: one clear button to pause it. */
function SoundDock() {
  const { engine, state } = useSound();
  if (!engine || !state.on) return null;
  return (
    <div className="sound-dock">
      <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-toggle sound-dock__btn" onClick={() => engine.pause()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6v12M15 6v12" />
        </svg>
        {state.ducked ? "Turn off ambient sound (paused for other audio)" : `Turn off ambient sound (${engine.track.title})`}
      </button>
    </div>
  );
}
