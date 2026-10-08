/**
 * D4 · The Hall: the day cycle and the scene's fixed geometry. Pure functions only (no DOM), so they run in three
 * places from one source: the tiny inline boot script (before first paint, so the page never shows the wrong sky),
 * the client component (as the clock moves), and the unit tests.
 *
 * The cycle position t runs 0 → 1: dusk 0, night .25, dawn .5, day .75, and back to dusk at 1.
 * The visitor's local clock picks t:
 *   05:00–08:00  dawn   t .25 → .75 (dawn's colors peak at 06:30)
 *   08:00–17:00  day    t .75 (held)
 *   17:00–20:00  dusk   t .75 → 1.25 (dusk's colors peak at 18:30; 1 is the same point as 0)
 *   20:00–05:00  night  t .25 (held)
 * so the sky never jumps: each change is a smooth pass between two held looks.
 */

/** One keyframe: t, sky opacity, sky top/mid/horizon (rgb), stars, cloud (rgba), photo brightness, photo saturation,
 * tint (rgb), tint opacity, windows, fireflies, mist, wash. From the reviewed prototype (appendix B, K). */
export type Key = [number, number, number[], number[], number[], number, number[], number, number, number[], number, number, number, number, number];

export const K: Key[] = [
  [0, 0, [12, 41, 87], [30, 66, 114], [150, 120, 130], 0.12, [9, 14, 40, 0.55], 1, 1, [0, 0, 0], 0, 1, 0.75, 0.55, 1],
  [0.25, 1, [2, 3, 12], [6, 11, 34], [14, 26, 58], 1, [4, 6, 20, 0.55], 0.62, 0.9, [0, 0, 0], 0, 1, 1, 0.6, 1],
  [0.5, 1, [27, 42, 92], [122, 116, 158], [246, 180, 140], 0.15, [200, 170, 190, 0.5], 0.95, 0.95, [255, 170, 120], 0.35, 0.45, 0.15, 0.7, 0.85],
  [0.75, 1, [52, 108, 184], [122, 170, 222], [214, 230, 244], 0, [255, 255, 255, 0.7], 1.9, 0.72, [255, 240, 215], 0.5, 0, 0, 0.22, 0.5],
  [1, 0, [12, 41, 87], [30, 66, 114], [150, 120, 130], 0.12, [9, 14, 40, 0.55], 1, 1, [0, 0, 0], 0, 1, 0.75, 0.55, 1],
];

export const PHASES = ["dusk", "night", "dawn", "day"] as const;
export type Phase = (typeof PHASES)[number];
/** Where each named phase sits on the cycle (used by the ?phase= review switch). */
export const PHASE_T: Record<Phase, number> = { dusk: 0, night: 0.25, dawn: 0.5, day: 0.75 };

/** Local hours (0–24, fractional) → cycle position t. Self-contained (no outside references): the boot script embeds it. */
export function cycleT(h: number): number {
  if (h >= 5 && h < 8) return 0.25 + ((h - 5) / 3) * 0.5;
  if (h >= 8 && h < 17) return 0.75;
  if (h >= 17 && h < 20) return 0.75 + ((h - 17) / 3) * 0.5;
  return 0.25;
}

/** Local hours → the named phase the visitor is in. Self-contained. */
export function phaseName(h: number): Phase {
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

/**
 * Cycle position → the scene's CSS custom properties, plus the firefly strength (used by the canvas, not CSS).
 * Values are rounded so a slowly moving clock only writes when something visibly changes; the photo's filter moves in
 * steps of 0.02. Self-contained (K is passed in): the boot script embeds it.
 */
export function hallVars(t: number, keys: Key[]): { vars: Record<string, string>; ff: number; win: number } {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  let u = (t - a[0]) / (b[0] - a[0]);
  u = u * u * (3 - 2 * u);
  const mix = (x: number, y: number) => x + (y - x) * u;
  const mixA = (x: number[], y: number[]) => x.map((v, j) => mix(v, y[j]));
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  const q = (v: number) => String(Math.round(v * 50) / 50);
  const rgb = (c: number[]) => "rgb(" + c.slice(0, 3).map(Math.round).join(" ") + ")";
  const bright = mix(a[7], b[7]), sat = mix(a[8], b[8]), wash = mix(a[14], b[14]);
  const cloud = mixA(a[6], b[6]);
  const scrim = Math.max(0, Math.min(1, (1 - wash) * 2));
  const tt = t;
  return {
    vars: {
      "--sky-op": n(mix(a[1], b[1])),
      "--sk-top": rgb(mixA(a[2], b[2])),
      "--sk-mid": rgb(mixA(a[3], b[3])),
      "--sk-hor": rgb(mixA(a[4], b[4])),
      "--stars": n(mix(a[5], b[5])),
      "--cloud": "rgb(" + cloud.slice(0, 3).map(Math.round).join(" ") + " / " + n(cloud[3]) + ")",
      "--imgf": Math.abs(bright - 1) < 0.01 && Math.abs(sat - 1) < 0.01 ? "none" : "brightness(" + q(bright) + ") saturate(" + q(sat) + ")",
      "--tint": rgb(mixA(a[9], b[9])),
      "--tint-op": n(mix(a[10], b[10])),
      "--win": n(mix(a[11], b[11])),
      "--mistop": n(mix(a[13], b[13])),
      "--wash": n(wash),
      "--scrim": n(scrim),
      "--glass-day": n(scrim),
      "--hero-shadow": tt > 0.62 && tt < 0.88 ? "rgb(6 14 40 / 0.55)" : "rgb(2 3 12 / 0.55)",
    },
    ff: mix(a[12], b[12]),
    win: mix(a[11], b[11]),
  };
}

/** Whether the ?phase= review switch is honored: never on the production site; on dev servers and Vercel previews. */
export function phaseQueryAllowed(nodeEnv: string | undefined, vercelEnv: string | undefined): boolean {
  return nodeEnv !== "production" || vercelEnv === "preview";
}

/** Reads ?phase=dusk|night|dawn|day when allowed; anything else (or not allowed) means "follow the clock". */
export function phaseFromQuery(search: string, allowed: boolean): Phase | null {
  if (!allowed) return null;
  const m = /[?&]phase=(dusk|night|dawn|day)(?:&|$)/.exec(search);
  return m ? (m[1] as Phase) : null;
}

/**
 * The inline script that runs while the page is still loading, before first paint: it sets the sky for the visitor's
 * local time on the Hall (#hall, already open in the document when the script runs) and notes a signed-in visitor (Clerk's __client_uat cookie is non-zero)
 * so the page shows Home instead of the Hall without a flash. Clerk still decides; the client component corrects it.
 */
export function bootScript(allowQuery: boolean): string {
  return `(function(){try{var K=${JSON.stringify(K)},P=${JSON.stringify(PHASE_T)};var cycleT=${cycleT.toString()};var phaseName=${phaseName.toString()};var hallVars=${hallVars.toString()};` +
    `var el=document.getElementById("hall");if(!el)return;var d=new Date(),h=d.getHours()+d.getMinutes()/60;` +
    `var m=${allowQuery ? "/[?&]phase=(dusk|night|dawn|day)(?:&|$)/.exec(location.search)" : "null"};var p=m?m[1]:phaseName(h);` +
    `var v=hallVars(m?P[p]:cycleT(h),K).vars;for(var k in v)el.style.setProperty(k,v[k]);el.setAttribute("data-phase",p);` +
    `if(/(?:^|; )__client_uat=[1-9]/.test(document.cookie)){var r=el.closest("[data-landing]");if(r)r.setAttribute("data-auth","in")}}catch(e){}})()`;
}

/** The 26 window panes, [x, y, w, h] in px of the 1344×752 photo (positioned as percentages, so they scale). */
export const WINDOWS: [number, number, number, number][] = [
  [431, 360, 23, 46], [431, 451, 23, 52], [483, 360, 24, 46], [483, 451, 24, 52], [570, 360, 23, 46], [570, 451, 23, 52],
  [623, 360, 23, 46], [623, 451, 23, 52], [702, 360, 16, 46], [702, 451, 16, 52], [752, 360, 23, 46], [752, 451, 23, 52],
  [820, 360, 23, 46], [820, 451, 23, 52], [891, 360, 22, 46], [891, 451, 22, 52], [947, 360, 16, 46], [947, 451, 16, 52],
  [1025, 360, 22, 46], [1025, 451, 22, 52], [1082, 360, 23, 46], [1082, 451, 23, 52], [1174, 353, 23, 52], [1174, 451, 23, 52],
  [1231, 353, 25, 52], [1231, 451, 25, 52],
];
export const PHOTO = { width: 1344, height: 752 } as const;

/** A small seeded random generator, so the server and the browser place stars and window timings identically. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each window's turn-on delay (s) and brightness: lights spread out from the middle, the upper floor a beat later. */
export function windowTimings(): { d: number; b: number }[] {
  const r = seeded(4);
  return WINDOWS.map(([x, y, w]) => ({
    d: Math.round((1.4 + (Math.abs(x + w / 2 - PHOTO.width / 2) / 500) * 3.2 + (y < 400 ? 0.55 : 0) + r() * 0.7) * 100) / 100,
    b: Math.round((0.6 + r() * 0.2) * 100) / 100,
  }));
}
