"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "ascentra.ambient";
const SRC = "/audio/ambient-loop.mp3";
const VOLUME = 0.22;

type Sound = { audio: HTMLAudioElement; ctx: AudioContext | null; gain: GainNode | null };

/**
 * D2c: opt-in ambient music. Off by default and never autoplays: nothing is downloaded until the first press. It loops
 * with a short fade in and out at a low volume, pauses while the tab is hidden, and this browser remembers the choice
 * (a remembered "on" still waits for a press to resume, since browsers and people both dislike sound that starts alone).
 */
export function AmbientSound() {
  const [on, setOn] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const sound = useRef<Sound | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the remembered choice once
      setRemembered(localStorage.getItem(KEY) === "on");
    } catch { /* storage blocked: nothing to remember */ }
  }, []);

  function fadeTo(target: number, seconds: number, then?: () => void) {
    const s = sound.current;
    if (!s) return;
    if (s.gain && s.ctx) {
      const now = s.ctx.currentTime;
      s.gain.gain.cancelScheduledValues(now);
      s.gain.gain.setValueAtTime(s.gain.gain.value, now);
      s.gain.gain.linearRampToValueAtTime(target, now + seconds);
    } else s.audio.volume = target;
    if (then) window.setTimeout(then, seconds * 1000 + 30);
  }

  async function start() {
    if (!sound.current) {
      const audio = new Audio(SRC);
      audio.loop = true;
      audio.preload = "auto";
      let ctx: AudioContext | null = null, gain: GainNode | null = null;
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          ctx = new AC();
          gain = ctx.createGain();
          gain.gain.value = 0;
          ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
        } else audio.volume = 0;
      } catch { ctx = null; gain = null; audio.volume = 0; }
      sound.current = { audio, ctx, gain };
    }
    const s = sound.current;
    await s.ctx?.resume().catch(() => undefined);
    await s.audio.play().catch(() => undefined);
    fadeTo(VOLUME, 1.6);
  }
  function stop() {
    fadeTo(0, 0.6, () => sound.current?.audio.pause());
  }

  async function toggle() {
    const next = !on;
    setOn(next);
    setRemembered(false);
    try { localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* not remembered */ }
    if (next) await start(); else stop();
  }

  useEffect(() => {
    if (!on) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") { sound.current?.audio.pause(); fadeTo(0, 0.01); }
      else void start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/fade only touch the ref
  }, [on]);

  useEffect(() => () => { sound.current?.audio.pause(); void sound.current?.ctx?.close().catch(() => undefined); }, []);

  return (
    <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sound-toggle" aria-pressed={on} onClick={() => void toggle()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3l5-4v13l-5-4H4z" />
        {on ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />}
      </svg>
      {on ? "Ambient sound: On" : remembered ? "Ambient sound: Off (press to resume)" : "Ambient sound: Off"}
    </button>
  );
}
