export const K = [
  [0, 0, [12, 41, 87], [30, 66, 114], [150, 120, 130], 0.12, [9, 14, 40, 0.55], 1, 1, [0, 0, 0], 0, 1, 0.75, 0.55, 1],
  [0.25, 1, [2, 3, 12], [6, 11, 34], [14, 26, 58], 1, [4, 6, 20, 0.55], 0.62, 0.9, [0, 0, 0], 0, 1, 1, 0.6, 1],
  [0.5, 1, [27, 42, 92], [122, 116, 158], [246, 180, 140], 0.15, [200, 170, 190, 0.5], 0.95, 0.95, [255, 170, 120], 0.35, 0.45, 0.15, 0.7, 0.85],
  [0.75, 1, [52, 108, 184], [122, 170, 222], [214, 230, 244], 0, [255, 255, 255, 0.7], 1.9, 0.72, [255, 240, 215], 0.5, 0, 0, 0.22, 0.5],
  [1, 0, [12, 41, 87], [30, 66, 114], [150, 120, 130], 0.12, [9, 14, 40, 0.55], 1, 1, [0, 0, 0], 0, 1, 0.75, 0.55, 1],
];
export const PHASE_T = { dusk: 0, night: .25, dawn: .5, day: .75 };
export function cycleT(h) { if (h >= 5 && h < 8) return .25 + ((h - 5) / 3) * .5; if (h >= 8 && h < 17) return .75; if (h >= 17 && h < 20) return .75 + ((h - 17) / 3) * .5; return .25; }
export function phaseName(h) { if (h >= 5 && h < 8) return 'dawn'; if (h >= 8 && h < 17) return 'day'; if (h >= 17 && h < 20) return 'dusk'; return 'night'; }
export function hallVars(t, keys) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  let u = (t - a[0]) / (b[0] - a[0]);
  u = u * u * (3 - 2 * u);
  const mix = (x, y) => x + (y - x) * u;
  const mixA = (x, y) => x.map((v, j) => mix(v, y[j]));
  const n = (v) => String(Math.round(v * 1000) / 1000);
  const q = (v) => String(Math.round(v * 50) / 50);
  const rgb = (c) => "rgb(" + c.slice(0, 3).map(Math.round).join(" ") + ")";
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
