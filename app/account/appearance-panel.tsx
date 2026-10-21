"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { EFFECTS, EFFECTS_LABEL, GLASSES, MOTION_LABEL, MOTIONS, THEME_LABEL, THEMES, type Glass } from "../env/prefs";
import { usePrefs } from "../landing/world/world-controls";
import { Segmented } from "../ui/design/segmented";
import { Glass as GlassPanel } from "../ui/design/glass-panel";
import { Button } from "../ui/design/button";
import { uiSounds } from "../ui/sound/ui-sounds";
import "./appearance.css";

const GLASS_LABEL: Record<Glass, string> = { liquid: "Liquid", frost: "Frosted" };
const noop = () => () => {};

/**
 * Appearance (D5; design rebuild D3): theme, glass, motion, effects and interface sounds, saved in this browser only
 * (saving to the account comes later), through the one preferences module (app/env/prefs.ts) and the existing sound
 * preference. Iris and Mono replace the D5 scenes (Owner decision 1), so there is no scene choice any more; a scene saved
 * before is simply ignored. Motion's middle level reads "Reduced" (stored as "simple", so saved choices still work).
 * When the device asked for less motion, ran slowly or counts as a Lite device, it says so here.
 */
export function AppearancePanel() {
  const [prefs, set] = usePrefs();
  const [auto, setAuto] = useState(false);
  const [lite, setLite] = useState(false);
  const sounds = uiSounds();
  const soundOn = useSyncExternalStore(sounds?.subscribe ?? noop, () => sounds?.enabled ?? false, () => false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => { setAuto(root.hasAttribute("data-motion-auto")); setLite(root.getAttribute("data-lite") === "1"); };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["data-motion-auto", "data-lite"] });
    return () => mo.disconnect();
  }, []);
  if (!prefs) return <p className="muted">Loading your appearance settings…</p>;
  return (
    <>
      <h2 id="appearance-h">Appearance</h2>
      <p className="muted">Saved in this browser only.</p>
      <div className="ap">
        <div className="ap__controls">
          <div className="ap__row">
            <p id="ap-theme" className="ds-caps ap__label">Theme</p>
            <Segmented label="Theme" value={prefs.theme} onChange={(v) => set("theme", v)} options={THEMES.map((t) => [t, THEME_LABEL[t]] as const)} />
            <p className="small muted">Iris is deep blue-violet. Mono is black and graphite with one warm white light.</p>
          </div>
          <div className="ap__row">
            <p className="ds-caps ap__label">Glass</p>
            <Segmented label="Glass" value={prefs.glass} onChange={(v) => set("glass", v)} options={GLASSES.map((g) => [g, GLASS_LABEL[g]] as const)} />
            <p className="small muted">Frosted is softer and easiest to read. Liquid bends what is behind it at the edges, in Chrome, Edge and other Chromium browsers; elsewhere it shows a lighter glass.</p>
          </div>
          <div className="ap__row">
            <p className="ds-caps ap__label">Motion</p>
            <Segmented label="Motion" value={prefs.motion} onChange={(v) => set("motion", v)} options={MOTIONS.map((m) => [m, MOTION_LABEL[m]] as const)} />
            <p className="small muted">Full: the background drifts and panels shimmer. Reduced: everything holds still and numbers simply show. Off: the same, for the whole page. Reduced motion on your device always means still.</p>
            {auto && prefs.motion === "full" && <p className="small" role="status">Motion is simplified on this device.</p>}
          </div>
          <div className="ap__row">
            <p className="ds-caps ap__label">Effects</p>
            <Segmented label="Effects" value={prefs.effects} onChange={(v) => set("effects", v)} options={EFFECTS.map((e) => [e, EFFECTS_LABEL[e]] as const)} />
            <p className="small muted">Automatic uses lighter glass and no Liquid on phones and slower devices. Always full keeps every effect.</p>
            {lite && prefs.effects === "auto" && <p className="small" role="status">Lighter effects are on for this device.</p>}
          </div>
          <div className="ap__row">
            <p className="ds-caps ap__label">Sound</p>
            <Segmented label="Interface sounds" value={soundOn ? "on" : "off"} onChange={(v) => sounds?.setEnabled(v === "on")} options={[["on", "On"], ["off", "Off"]] as const} />
            <p className="small muted">Soft clicks on buttons, and a short sound when you claim a reward. Never plays on its own. Separate from motion and from the ambient music.</p>
          </div>
        </div>
        {/* A picture of the choices, not a control: inert (not focusable, hidden from assistive technology). */}
        <div className="ap__preview" inert>
          <div className="ap__stage" aria-hidden="true"><i /><i /><i /></div>
          <GlassPanel className="ap__glass">
            <p className="ds-caps">Preview</p>
            <p className="ap__title">Section 2 · Cold email</p>
            <p className="small muted">This is how panels look with your choices.</p>
            <Button variant="primary" size="sm" icon="book" sfx="none">Continue</Button>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
