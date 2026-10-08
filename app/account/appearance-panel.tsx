"use client";

import { useEffect, useState } from "react";
import { GLASSES, MOTIONS, SCENE_INFO, SCENES, type Glass, type Motion } from "../env/prefs";
import { usePrefs } from "../landing/world/world-controls";

const GLASS_LABEL: Record<Glass, string> = { liquid: "Liquid", frost: "Frosted" };
const MOTION_LABEL: Record<Motion, string> = { full: "Full", simple: "Simple", off: "Off" };

/**
 * D5 · Appearance: the wallpaper scene, the glass material and how much the wallpaper moves. Saved in this browser only
 * (saving to the account comes later). When the device asked for less motion or ran slowly, it says so here.
 */
export function AppearancePanel() {
  const [prefs, set] = usePrefs();
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const read = () => setAuto(document.documentElement.hasAttribute("data-motion-auto"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion-auto"] });
    return () => mo.disconnect();
  }, []);
  if (!prefs) return <p className="muted">Loading your appearance settings…</p>;
  return (
    <>
      <h2 id="appearance-h">Appearance</h2>
      <p className="muted">Saved in this browser only.</p>
      <div className="ui-appearance">
        <div role="group" aria-labelledby="ap-scene">
          <p id="ap-scene" className="ui-appearance__label">Scene</p>
          <div className="ui-actions">
            {SCENES.map((s) => <button key={s} type="button" className="ui-btn ui-btn--sm" aria-pressed={prefs.scene === s} onClick={() => set("scene", s)}>{SCENE_INFO[s].label}</button>)}
          </div>
        </div>
        <div role="group" aria-labelledby="ap-glass">
          <p id="ap-glass" className="ui-appearance__label">Glass</p>
          <div className="ui-actions">
            {GLASSES.map((g) => <button key={g} type="button" className="ui-btn ui-btn--sm" aria-pressed={prefs.glass === g} onClick={() => set("glass", g)}>{GLASS_LABEL[g]}</button>)}
          </div>
          <p className="small muted">Liquid bends the scene at its edges. Frosted is softer and easiest to read.</p>
        </div>
        <div role="group" aria-labelledby="ap-motion">
          <p id="ap-motion" className="ui-appearance__label">Motion</p>
          <div className="ui-actions">
            {MOTIONS.map((m) => <button key={m} type="button" className="ui-btn ui-btn--sm" aria-pressed={prefs.motion === m} onClick={() => set("motion", m)}>{MOTION_LABEL[m]}</button>)}
          </div>
          <p className="small muted">Full: the scene moves. Simple: the photo drifts slowly. Off: a still photo. Reduced motion on your device always means still.</p>
          {auto && prefs.motion === "full" && <p className="small" role="status">Motion is simplified on this device.</p>}
        </div>
      </div>
    </>
  );
}
