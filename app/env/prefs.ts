/**
 * D5 · Appearance preferences: the wallpaper scene, the glass material and the motion level. Stored in this browser's
 * localStorage only (account-level saving is a later stage). Anything missing, unknown or unreadable falls back to the
 * defaults, and a browser that blocks storage never breaks the page.
 */
export const SCENES = ["reef", "lake", "mist", "sun", "hall"] as const;
export type Scene = (typeof SCENES)[number];
export const GLASSES = ["liquid", "frost"] as const;
export type Glass = (typeof GLASSES)[number];
export const MOTIONS = ["full", "simple", "off"] as const;
export type Motion = (typeof MOTIONS)[number];

export type Prefs = { scene: Scene; glass: Glass; motion: Motion };
export const DEFAULTS: Prefs = { scene: "lake", glass: "liquid", motion: "full" };
export const KEYS = { scene: "ascentra.scene", glass: "ascentra.glass", motion: "ascentra.motion" } as const;

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
  };
}

/** Saves one preference; returns false (and changes nothing) when the value is invalid or storage is unavailable. */
export function writePref<K extends keyof Prefs>(key: K, value: Prefs[K], store?: StorageLike | null): boolean {
  const allowed = { scene: SCENES, glass: GLASSES, motion: MOTIONS }[key] as readonly string[];
  if (!allowed.includes(value)) return false;
  try {
    const s = store === undefined ? window.localStorage : store;
    if (!s) return false;
    s.setItem(KEYS[key], value);
    return true;
  } catch { return false; }
}

/**
 * The tiny script that runs before first paint (raw markup in the root layout) so the page starts in the visitor's
 * scene, glass and motion without a flash. Same rules as readPrefs: unknown values fall back to the defaults.
 */
export function prefsBootScript(): string {
  const lists = JSON.stringify({ scene: SCENES, glass: GLASSES, motion: MOTIONS });
  return `(function(){var d=document.documentElement,L=${lists},D=${JSON.stringify(DEFAULTS)},K=${JSON.stringify(KEYS)};` +
    `for(var k in K){var v=null;try{v=localStorage.getItem(K[k])}catch(e){}d.setAttribute("data-"+k,L[k].indexOf(v)>=0?v:D[k])}})()`;
}

/** Applies preferences to <html> (the CSS reads data-scene, data-glass and data-motion) and tells listeners. */
export function applyPrefs(p: Prefs) {
  const d = document.documentElement;
  d.setAttribute("data-scene", p.scene);
  d.setAttribute("data-glass", p.glass);
  d.setAttribute("data-motion", p.motion);
  window.dispatchEvent(new CustomEvent("ascentra:prefs", { detail: p }));
}
