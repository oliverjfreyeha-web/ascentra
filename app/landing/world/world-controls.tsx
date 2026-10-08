"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { applyPrefs, GLASSES, readPrefs, SCENE_INFO, SCENES, writePref, type Glass, type Prefs, type Scene } from "../../env/prefs";

/** Keeps a component in step with the saved preferences (this browser only). */
export function usePrefs(): [Prefs | null, <K extends keyof Prefs>(k: K, v: Prefs[K]) => void] {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this browser's saved choice after hydration
    setPrefs(readPrefs());
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener("ascentra:prefs", on);
    return () => window.removeEventListener("ascentra:prefs", on);
  }, []);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    writePref(k, v);
    applyPrefs({ ...(prefs ?? readPrefs()), [k]: v });
  };
  return [prefs, set];
}

const GLASS_LABEL: Record<Glass, string> = { liquid: "Liquid", frost: "Frosted" };

/** The scene and glass switchers at the bottom of the landing page, plus Hide interface. Real buttons with aria-pressed. */
export function WorldDock({ hideable = true }: { hideable?: boolean }) {
  const [prefs, set] = usePrefs();
  const hideBtn = useRef<HTMLButtonElement>(null);
  const showBtn = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const ui = document.getElementById("world-ui");
    ui?.toggleAttribute("data-off", hidden);
    ui?.toggleAttribute("inert", hidden);
    if (hidden) showBtn.current?.focus();
  }, [hidden]);
  const scene = prefs?.scene ?? "lake", glass = prefs?.glass ?? "liquid";
  return (
    <>
      <div className="world__dock">
        <div className="ui-glass world__dockin" role="group" aria-label="Scene">
          {SCENES.map((s: Scene) => (
            <button key={s} type="button" className="world__pill ui-plain" aria-pressed={scene === s} onClick={() => set("scene", s)}>{SCENE_INFO[s].label}</button>
          ))}
        </div>
        <div className="ui-glass world__dockin" role="group" aria-label="Glass">
          {GLASSES.map((g) => (
            <button key={g} type="button" className="world__pill ui-plain" aria-pressed={glass === g} onClick={() => set("glass", g)}>{GLASS_LABEL[g]}</button>
          ))}
          {hideable && <i className="world__sep" aria-hidden="true" />}
          {hideable && <button ref={hideBtn} type="button" className="world__pill ui-plain" onClick={() => setHidden(true)}>Hide interface</button>}
        </div>
      </div>
      {hidden && (
        <button ref={showBtn} type="button" className="world__show ui-glass ui-plain" onClick={() => { setHidden(false); requestAnimationFrame(() => hideBtn.current?.focus()); }}>Show interface</button>
      )}
    </>
  );
}

/** Signed-in visitors see Home instead of the landing hero. Clerk decides; the boot script only guessed from a cookie. */
export function AuthSwitch() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    const landing = document.querySelector<HTMLElement>("[data-landing]");
    if (isSignedIn) landing?.setAttribute("data-auth", "in"); else landing?.removeAttribute("data-auth");
  }, [isLoaded, isSignedIn]);
  return null;
}

/** The Hall (D4) as the fifth scene: rendered only when chosen, so its pictures load only for those who pick it. */
export function HallSlot({ children }: { children: ReactNode }) {
  const [prefs] = usePrefs();
  if (prefs?.scene !== "hall") return null;
  return <div className="world-hall">{children}<div className="world-hall__dock"><WorldDock hideable={false} /></div></div>;
}
