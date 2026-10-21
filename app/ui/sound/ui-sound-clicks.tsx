"use client";

import { useEffect } from "react";
import { isUiSound, uiSounds } from "./ui-sounds";

/**
 * Design rebuild D2 · Mounted once in the root layout. Unlocks UI sounds on the page's first real press, then plays the
 * sound named by data-sfx on the control that was clicked (only the rebuild's controls carry it; "none" is silent).
 * Does nothing at all while UI sounds are off, which is the default.
 */
export function UiSoundClicks() {
  useEffect(() => {
    const s = uiSounds();
    if (!s) return;
    const unlock = () => s.unlock();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-sfx]") as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const name = el.dataset.sfx;
      if (isUiSound(name)) s.play(name);
    };
    window.addEventListener("pointerdown", unlock, { capture: true, once: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
