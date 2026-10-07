"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSound } from "./sound/sound-provider";
import { TRACKS } from "./sound/tracks";

/**
 * D2e: the Ambient sound control (in the footer of the signed-out and learner screens) and its sound panel. The music
 * itself lives in <SoundProvider> in the root layout, so it keeps playing across screens and in background tabs.
 * Off by default, and it never starts on its own: only a press here (or a media key) starts it. A reload starts off.
 */
export function AmbientSound() {
  const { engine, state, register } = useSound();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const panelId = useId();
  const more = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => register(), [register]);

  // Announce changes (not the first render): on/off, paused for other audio, and the track.
  const title = TRACKS.find((t) => t.id === state.trackId)?.title ?? "";
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaid(!state.on ? "Ambient sound off." : state.ducked ? "Ambient sound paused while other audio plays." : `Ambient sound on: ${title}.`);
  }, [state.on, state.ducked, title]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); more.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const label = !state.on ? "Ambient sound: Off" : state.ducked ? "Ambient sound: Paused for other audio" : "Ambient sound: On";
  return (
    <div className="sound" ref={wrap}>
      <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-toggle" aria-pressed={state.on} disabled={!engine} onClick={() => void engine?.toggle()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9.5h3l5-4v13l-5-4H4z" />
          {state.on ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />}
        </svg>
        {label}
      </button>
      <button ref={more} type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-more" aria-expanded={open} aria-controls={panelId} disabled={!engine} onClick={() => setOpen((o) => !o)}>
        Sound options
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {open && engine && (
        <div id={panelId} className="sound-panel" role="group" aria-label="Ambient sound options">
          <p className="ui-label sound-panel__head">Soundtracks</p>
          <ul className="sound-panel__list">
            {TRACKS.map((t) => {
              const current = t.id === state.trackId;
              return (
                <li key={t.id}>
                  <button type="button" className="ui-plain sound-panel__track" aria-current={current ? "true" : undefined} onClick={() => engine.select(t.id)}>
                    <span className="sound-panel__title">{t.title}{current && <span className="sound-panel__now">{state.on && !state.ducked ? "Playing" : "Selected"}</span>}</span>
                    <span className="sound-panel__mood">{t.mood} · {t.aiLabel} ({t.tool})</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="sound-panel__row">
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => engine.previous()}>Previous track</button>
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => engine.next()}>Next track</button>
          </div>
          <div className="sound-panel__row">
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-panel__opt" aria-pressed={state.shuffle} onClick={() => engine.setShuffle(!state.shuffle)}>Shuffle</button>
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-panel__opt" aria-pressed={state.loop} onClick={() => engine.setLoop(!state.loop)}>Repeat this track</button>
          </div>
          <label className="sound-panel__volume">
            <span>Volume</span>
            <input type="range" min={0} max={100} step={1} value={state.volume} aria-valuetext={`${state.volume}%`} onChange={(e) => engine.setVolume(Number(e.target.value))} />
          </label>
          <p className="muted small sound-panel__note">
            Choosing a track never starts the music; only the Ambient sound button does. Once on, it keeps playing across
            screens and in other tabs until you turn it off. Reloading the page or leaving ASCENTRA stops it.
          </p>
        </div>
      )}
    </div>
  );
}
