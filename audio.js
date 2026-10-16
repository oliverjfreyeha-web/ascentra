/* Reward sound, made live with the Web Audio API (no audio file): sub boom, fire whoosh, crackle, then rising sparkle chimes. */
let ctx;
export function playReward() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + .02, out = ctx.createGain(); out.gain.value = .5; out.connect(ctx.destination);
    // boom
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(34, t0 + .7); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.9, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + .9); o.connect(g).connect(out); o.start(t0); o.stop(t0 + 1);
    // whoosh (filtered noise)
    const len = ctx.sampleRate * 1.4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = .8; f.frequency.setValueAtTime(2600, t0); f.frequency.exponentialRampToValueAtTime(260, t0 + 1.1);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(.55, t0 + .04); ng.gain.exponentialRampToValueAtTime(.001, t0 + 1.2); n.connect(f).connect(ng).connect(out); n.start(t0);
    // crackle
    for (let i = 0; i < 26; i++) { const tt = t0 + .12 + Math.random() * 1.2, b = ctx.createBufferSource(); b.buffer = buf; const bf = ctx.createBiquadFilter(); bf.type = "highpass"; bf.frequency.value = 2500 + Math.random() * 3000; const bg = ctx.createGain(); bg.gain.setValueAtTime(.18 * (1 - (tt - t0) / 1.5), tt); bg.gain.exponentialRampToValueAtTime(.001, tt + .035); b.connect(bf).connect(bg).connect(out); b.start(tt, Math.random() * .5, .05); }
    // chimes (pentatonic, rising)
    [659.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98].forEach((fr, i) => { const tt = t0 + .28 + i * .09, c = ctx.createOscillator(), cg = ctx.createGain(); c.type = "triangle"; c.frequency.value = fr; cg.gain.setValueAtTime(0, tt); cg.gain.linearRampToValueAtTime(.22, tt + .01); cg.gain.exponentialRampToValueAtTime(.001, tt + 1.1); c.connect(cg).connect(out); c.start(tt); c.stop(tt + 1.2); });
  } catch (e) { /* audio is optional */ }
}

/* Small-action sounds: each action has its own voice. Never plays unless sound is on. */
let on = true; export const setSound = (v) => { on = v; };
function tone(c, out, t, f0, f1, dur, type = "sine", vol = .5, lp) {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0008, t + dur); let n = o; if (lp) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); n = f; } n.connect(g).connect(out); o.start(t); o.stop(t + dur + .05);
}
/* Soft keyboard-style clicks: a tiny filtered noise tick plus a short low "thock". Calm, no chimes. */
function click(c, out, t, { f = 2200, q = 1.1, body = 180, vol = 1, dur = .028 } = {}) {
  const len = Math.floor(c.sampleRate * .06), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * dur * .4));
  const n = c.createBufferSource(); n.buffer = b; const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q; const g = c.createGain(); g.gain.value = .9 * vol; n.connect(bp).connect(g).connect(out); n.start(t);
  const o = c.createOscillator(), og = c.createGain(); o.type = "sine"; o.frequency.setValueAtTime(body, t); o.frequency.exponentialRampToValueAtTime(body * .6, t + .045); og.gain.setValueAtTime(.0001, t); og.gain.linearRampToValueAtTime(.35 * vol, t + .003); og.gain.exponentialRampToValueAtTime(.0005, t + .05); o.connect(og).connect(out); o.start(t); o.stop(t + .07);
}
export function sfx(name) {
  if (!on) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime + .005, out = ctx.createGain(); out.gain.value = .16; out.connect(ctx.destination);
    const j = 1 + (Math.random() - .5) * .06; // tiny variation so repeats do not sound robotic
    switch (name) {
      case "tap": click(ctx, out, t, { f: 2300 * j, body: 190 }); break;
      case "nav": click(ctx, out, t, { f: 1900 * j, body: 150, vol: 1.1 }); break;
      case "on": click(ctx, out, t, { f: 2600 * j, body: 210 }); click(ctx, out, t + .045, { f: 3000 * j, body: 240, vol: .6 }); break;
      case "off": click(ctx, out, t, { f: 1700 * j, body: 140 }); click(ctx, out, t + .045, { f: 1400 * j, body: 120, vol: .6 }); break;
      case "add": click(ctx, out, t, { f: 2400 * j, body: 200 }); click(ctx, out, t + .06, { f: 2900 * j, body: 230, vol: .8 }); break;
      case "remove": click(ctx, out, t, { f: 1500 * j, body: 130, vol: .9 }); break;
      case "open": click(ctx, out, t, { f: 1600 * j, body: 120, vol: 1.1, dur: .04 }); break;
      case "correct": click(ctx, out, t, { f: 2800 * j, body: 260 }); click(ctx, out, t + .07, { f: 3200 * j, body: 300, vol: .8 }); break;
      case "wrong": click(ctx, out, t, { f: 900 * j, q: .8, body: 100, vol: 1.1, dur: .05 }); break;
      case "done": [0, .06, .12].forEach((d, i) => click(ctx, out, t + d, { f: (2200 + i * 350) * j, body: 200 + i * 30, vol: .8 })); break;
      case "slider": click(ctx, out, t, { f: 3200, body: 260, vol: .35, dur: .015 }); break;
    }
  } catch (e) { /* optional */ }
}
