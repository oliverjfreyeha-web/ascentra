/**
 * D5 · Appearance preferences: the wallpaper scene, the glass material and the motion level. Stored in this browser's
 * localStorage only (account-level saving is a later stage). Anything missing, unknown or unreadable falls back to the
 * defaults, and a browser that blocks storage never breaks the page.
 * Design rebuild D1: adds the theme (Iris or Mono, html[data-theme]) and html[data-reduced] ("1" when motion is not
 * Full, the device asks for reduced motion, or a slow device turned motion down). Frosted is the default glass. The
 * stored values are unchanged ("simple" is shown to people as "Reduced"), so saved choices keep working.
 */
export const SCENES = ["reef", "lake", "mist", "sun", "hall"] as const;
export type Scene = (typeof SCENES)[number];
export const GLASSES = ["liquid", "frost"] as const;
export type Glass = (typeof GLASSES)[number];
export const MOTIONS = ["full", "simple", "off"] as const;
export type Motion = (typeof MOTIONS)[number];
export const THEMES = ["iris", "mono"] as const;
export type Theme = (typeof THEMES)[number];

export type Prefs = { scene: Scene; glass: Glass; motion: Motion; theme: Theme };
export const DEFAULTS: Prefs = { scene: "lake", glass: "frost", motion: "full", theme: "iris" };
export const KEYS = { scene: "ascentra.scene", glass: "ascentra.glass", motion: "ascentra.motion", theme: "ascentra.theme" } as const;
const LISTS = { scene: SCENES, glass: GLASSES, motion: MOTIONS, theme: THEMES } as const;

/** What people see for each motion level (the stored value "simple" reads "Reduced"). */
export const MOTION_LABEL: Record<Motion, string> = { full: "Full", simple: "Reduced", off: "Off" };
export const THEME_LABEL: Record<Theme, string> = { iris: "Iris", mono: "Mono" };

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** What each scene is called, and the headline's italic word for it ("Learn inside a calm world."). */
export const SCENE_INFO: Record<Scene, { label: string; word: string }> = {
  reef: { label: "Reef", word: "living" },
  lake: { label: "Alpine lake", word: "calm" },
  mist: { label: "Misty peak", word: "rising" },
  sun: { label: "Sunrise", word: "waking" },
  hall: { label: "The Hall", word: "living" },
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Reads the saved preferences; never throws. `store` is injectable for tests (defaults to window.localStorage). */
export function readPrefs(store?: StorageLike | null): Prefs {
  let s: StorageLike | null = null;
  try {
    s = store === undefined ? (typeof window === "undefined" ? null : window.localStorage) : store;
  } catch { s = null; }
  const get = (k: string) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
  return {
    scene: pick(get(KEYS.scene), SCENES, DEFAULTS.scene),
    glass: pick(get(KEYS.glass), GLASSES, DEFAULTS.glass),
    motion: pick(get(KEYS.motion), MOTIONS, DEFAULTS.motion),
    theme: pick(get(KEYS.theme), THEMES, DEFAULTS.theme),
  };
}

/** Saves one preference; returns false (and changes nothing) when the value is invalid or storage is unavailable. */
export function writePref<K extends keyof Prefs>(key: K, value: Prefs[K], store?: StorageLike | null): boolean {
  const allowed = LISTS[key] as readonly string[];
  if (!allowed.includes(value)) return false;
  try {
    const s = store === undefined ? window.localStorage : store;
    if (!s) return false;
    s.setItem(KEYS[key], value);
    return true;
  } catch { return false; }
}

/** Whether motion is turned down: any level but Full, the device's reduced-motion setting, or a slow device. */
export function isReduced(motion: Motion, osReduce: boolean, auto = false): boolean {
  return motion !== "full" || osReduce || auto;
}

/**
 * The tiny script that runs before first paint (raw markup in the root layout) so the page starts in the visitor's
 * scene, glass, motion and theme without a flash, with data-reduced already set. Same rules as readPrefs: unknown
 * values fall back to the defaults.
 */
export function prefsBootScript(): string {
  return `(function(){var d=document.documentElement,L=${JSON.stringify(LISTS)},D=${JSON.stringify(DEFAULTS)},K=${JSON.stringify(KEYS)},o={};` +
    `for(var k in K){var v=null;try{v=localStorage.getItem(K[k])}catch(e){}o[k]=L[k].indexOf(v)>=0?v:D[k];d.setAttribute("data-"+k,o[k])}` +
    `var r=o.motion!=="full";try{r=r||matchMedia(${JSON.stringify(REDUCE_QUERY)}).matches}catch(e){}d.setAttribute("data-reduced",r?"1":"0")})()`;
}

/** Re-computes html[data-reduced] from html[data-motion], html[data-motion-auto] and the device setting. */
export function syncReduced() {
  const d = document.documentElement;
  const motion = pick(d.getAttribute("data-motion"), MOTIONS, DEFAULTS.motion);
  let os = false;
  try { os = window.matchMedia(REDUCE_QUERY).matches; } catch { /* no matchMedia */ }
  d.setAttribute("data-reduced", isReduced(motion, os, d.hasAttribute("data-motion-auto")) ? "1" : "0");
}

/** Applies preferences to <html> (the CSS reads data-scene, data-glass, data-motion, data-theme, data-reduced) and tells listeners. */
export function applyPrefs(p: Prefs) {
  const d = document.documentElement;
  d.setAttribute("data-scene", p.scene);
  d.setAttribute("data-glass", p.glass);
  d.setAttribute("data-motion", p.motion);
  d.setAttribute("data-theme", p.theme);
  syncReduced();
  window.dispatchEvent(new CustomEvent("ascentra:prefs", { detail: p }));
}
