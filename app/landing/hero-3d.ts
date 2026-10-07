/**
 * D2d · The hero's 3D stage, made only in code (no model or HDR files): a few frosted liquid-glass blocks and one
 * brushed-metal ring on a dark stage, lit by procedural light panels, with a calm particle ring behind them.
 * Loaded lazily by ./hero-scene.tsx after first paint, and only where the checks there pass. Decorative only: the
 * canvas is aria-hidden, ignores the pointer (clicks and typing go through) and never touches scrolling.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight,
  Float32BufferAttribute, FogExp2, Group, LinearSRGBColorSpace, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, Scene, SRGBColorSpace, Timer, TorusGeometry,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type HeroSceneOptions = { onReady: () => void; onFail: () => void };

const FROZEN = 0xa0bddb;
const STAGE = 0x0a0b17;
const MAX_DPR = 1.5;

/** The frost token (--frost-strength, 0 to 1) shared with the CSS frost on the cards. */
function frostStrength(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--frost-strength"));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

/** Studio light from panels: an environment map baked once from a dark room with a few glowing rectangles. */
function studioEnvironment(renderer: WebGLRenderer) {
  const room = new Scene();
  room.add(new Mesh(new BoxGeometry(20, 20, 20), new MeshBasicMaterial({ color: 0x05060c, side: BackSide })));
  const panel = (w: number, h: number, color: number, power: number, x: number, y: number, z: number, rx = 0, ry = 0) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power) }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.lookAt(0, 0, 0); room.add(m);
  };
  panel(10, 4, 0xeef4fb, 4.5, 0, 8.5, 3);         // key softbox, above
  panel(1.6, 10, 0xdbe7f3, 3.6, -8.5, 1, 4);      // left strip
  panel(1.6, 10, FROZEN, 3.2, 8.5, 0.5, -1);      // cool rim, right
  panel(1.2, 7, 0xc9d8e8, 2.6, 3, 1, 8.5);        // front-right fill, for the metal's highlights
  panel(5, 1.2, 0xeef4fb, 3.0, -2, 4, 7);         // a long front-top strip: clean highlights along the glass edges
  panel(10, 3, 0x6e86a3, 0.9, 0, -8, 2);          // floor bounce
  panel(14, 6, 0x1a2234, 1, 0, 2, -9.5);          // a dim back wall, so reflections have a horizon
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  room.traverse((o) => { const m = o as Mesh; m.geometry?.dispose(); (m.material as MeshBasicMaterial | undefined)?.dispose?.(); });
  return env;
}

/**
 * Frost for the glass: the shared frost map, strongest at the edges and corners of each face and fading toward a
 * clear middle (ice creeping in from the rim of a lake). Returns textures for roughness, bump, alpha and a faint glow.
 */
async function frostTextures(strength: number) {
  const img = new Image();
  img.decoding = "async";
  img.src = "/art/frost.webp";
  await img.decode();
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  // A crop of the map, scaled up, so each face shows a few readable crystals rather than fine grit.
  g.drawImage(img, img.width * 0.08, img.height * 0.2, img.width * 0.7, img.height * 0.7, 0, 0, S, S);
  const src = g.getImageData(0, 0, S, S);
  const rough = g.createImageData(S, S), alpha = g.createImageData(S, S), glow = g.createImageData(S, S);
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / (S - 1), v = y / (S - 1), i = (y * S + x) * 4;
    const edge = 1 - smooth(0.0, 0.24, Math.min(u, v, 1 - u, 1 - v));
    const corner = 1 - smooth(0.04, 0.48, Math.min(Math.hypot(u, v), Math.hypot(1 - u, v), Math.hypot(u, 1 - v), Math.hypot(1 - u, 1 - v)));
    const mask = Math.min(1, edge * 0.75 + corner * 0.8);
    const m = src.data[i] / 255, f = smooth(0.1, 0.55, m) * mask * strength; // crystals, not the haze between them
    const r = Math.round((0.05 + f * 0.9) * 255);
    rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = r; rough.data[i + 3] = 255;
    const a = Math.round((0.9 + 0.1 * Math.min(1, f * 1.6)) * 255);
    alpha.data[i] = alpha.data[i + 1] = alpha.data[i + 2] = a; alpha.data[i + 3] = 255;
    const l = Math.round(smooth(0.04, 0.32, f) * 255); // crystals only, no grey veil
    glow.data[i] = glow.data[i + 1] = glow.data[i + 2] = l; glow.data[i + 3] = 255;
  }
  const tex = (data: ImageData, srgb = false) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    cv.getContext("2d")!.putImageData(data, 0, 0);
    const t = new CanvasTexture(cv);
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { rough: tex(rough), alpha: tex(alpha), glow: tex(glow, true) };
}

/** The stage: a soft pool of cool light behind the cluster, falling off to the page color. */
function stageGlow() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(128, 116, 0, 128, 128, 128);
  grd.addColorStop(0, "#333e51"); grd.addColorStop(0.28, "#1d2536"); grd.addColorStop(0.75, "#0b0c19"); grd.addColorStop(1, "#0a0b17");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A round, soft point sprite for the particles (so they read as dust, not squares). */
function dotSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,0.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Mounts the stage into `host`. Returns a function that stops it and frees the GPU memory. */
export function mountHeroScene(host: HTMLElement, opts: HeroSceneOptions): () => void {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: true });
  if (!gl) { opts.onFail(); return () => {}; }
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.outputColorSpace = SRGBColorSpace;
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  // An opaque dark stage (faded into the page by a CSS mask on the canvas), so the glass has something to refract.
  const scene = new Scene();
  scene.background = new Color(STAGE);
  scene.environment = studioEnvironment(renderer);
  scene.fog = new FogExp2(STAGE, 0.05);
  const backdrop = new Mesh(new PlaneGeometry(22, 22), new MeshBasicMaterial({ map: stageGlow(), fog: false }));
  backdrop.position.z = -5;
  scene.add(backdrop);
  const camera = new PerspectiveCamera(28, 1, 0.1, 60);
  camera.position.set(0, 0.15, 10.5);

  // Two soft lights for crisp highlights on the glass edges and the ring (the panels above do the rest).
  const key = new DirectionalLight(0xeef4fb, 2.2);
  key.position.set(-3, 5, 4);
  const rim = new DirectionalLight(FROZEN, 1.4);
  rim.position.set(4, 1, -3);
  scene.add(key, rim);

  const rig = new Group();
  rig.scale.setScalar(0.84);
  scene.add(rig);

  // The glass: three frosted blocks, staggered like the sculpture in the still image.
  const glass = new MeshPhysicalMaterial({
    color: 0xf2f6fb, metalness: 0, roughness: 0.12, transmission: 1, thickness: 1.4, ior: 1.5,
    attenuationColor: new Color(0xd6e4f2), attenuationDistance: 6, clearcoat: 1, clearcoatRoughness: 0.08,
    specularIntensity: 1, specularColor: new Color(0xffffff), envMapIntensity: 2.6, transparent: true, emissive: new Color(0xb8cce2), emissiveIntensity: 0,
  });
  const blocks: { mesh: Mesh; base: [number, number, number]; phase: number; spin: number }[] = [];
  const addBlock = (w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, phase: number) => {
    const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * 0.14), glass);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    rig.add(mesh);
    blocks.push({ mesh, base: [x, y, z], phase, spin: 0.04 + phase * 0.01 });
  };
  addBlock(1.55, 1.55, 0.42, -0.35, 0.35, 0.2, 0.18, -0.5, 0.12, 0);
  addBlock(1.05, 1.9, 0.36, 0.75, -0.25, -0.5, -0.1, 0.62, -0.18, 1.7);
  addBlock(0.95, 0.95, 0.95, 0.05, -0.95, 0.75, 0.55, 0.35, 0.2, 3.1);

  // One brushed-metal ring, threaded through the cluster; clean, never frosted.
  const ring = new Mesh(
    new TorusGeometry(1.25, 0.075, 40, 180),
    new MeshPhysicalMaterial({ color: 0xb4c0cd, metalness: 1, roughness: 0.3, anisotropy: 0.85, anisotropyRotation: Math.PI / 2, clearcoat: 0.25, clearcoatRoughness: 0.2, envMapIntensity: 1.6 }),
  );
  ring.rotation.set(1.05, 0.35, 0.2);
  rig.add(ring);

  // The particle ring and a little dust, behind the glass. Cheap points, no post-processing.
  const sprite = dotSprite();
  const ringPts: number[] = [], dustPts: number[] = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2, r = 2.45 + gauss() * 0.26;
    ringPts.push(Math.cos(a) * r, gauss() * 0.12, Math.sin(a) * r);
  }
  for (let i = 0; i < 420; i++) dustPts.push((rnd() - 0.5) * 9, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6 - 1.5);
  const pointsOf = (arr: number[], size: number, opacity: number) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(arr, 3));
      // Not "transparent", so the glass's transmission pass sees (and refracts) them; additive blending still applies.
    return new Points(geo, new PointsMaterial({ color: new Color(FROZEN).multiplyScalar(opacity), size, map: sprite, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
  };
  const particleRing = pointsOf(ringPts, 0.11, 0.55);
  particleRing.rotation.set(1.32, 0, -0.3);
  particleRing.position.set(0.1, -0.1, -1.6);
  const dust = pointsOf(dustPts, 0.08, 0.35);
  scene.add(particleRing, dust);

  // The frost grows in over ~1.2 s once its map is ready and the canvas is showing.
  let frostAt = -1, frostReady = false;
  const strength = frostStrength();
  frostTextures(strength).then(({ rough, alpha, glow }) => {
    glass.roughnessMap = rough; glass.bumpMap = rough; glass.bumpScale = 0.9; glass.alphaMap = alpha;
    glass.emissiveMap = glow; glass.roughness = 0.15; glass.needsUpdate = true;
    frostReady = true;
  }).catch(() => { /* no frost: clear glass still reads well */ });

  // Pointer: a gentle parallax and tilt toward the cursor. Listens passively; never prevents anything.
  let tx = 0, ty = 0, px = 0, py = 0;
  const onMove = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; };
  window.addEventListener("pointermove", onMove, { passive: true });

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const timer = new Timer();
  let ready = false, frames = 0, guardFrom = -1, guardFrames = 0;
  const tick = (now: number) => {
    timer.update(now);
    const t = timer.getElapsed();
    px += (tx - px) * 0.045; py += (ty - py) * 0.045;
    rig.rotation.y = px * 0.22; rig.rotation.x = py * 0.12;
    camera.position.x = px * 0.35; camera.position.y = 0.15 - py * 0.22; camera.lookAt(0, 0, 0);
    for (const b of blocks) {
      b.mesh.position.y = b.base[1] + Math.sin(t * 0.35 + b.phase) * 0.06;
      b.mesh.rotation.y += b.spin * 0.004;
    }
    ring.rotation.z = 0.2 + Math.sin(t * 0.12) * 0.08;
    particleRing.rotation.y = t * 0.018;
    dust.rotation.y = t * 0.006;
    if (ready && frostReady && frostAt === -1) frostAt = t;
    if (frostAt >= 0) {
      const k = Math.min(1, (t - frostAt) / 1.2), e = 1 - Math.pow(1 - k, 3);
      glass.roughness = 0.15 + 0.85 * e;
      glass.emissiveIntensity = 0.3 * e;
      if (k >= 1) frostAt = -2;
    }
    renderer.render(scene, camera);
    // Low-power guard: measured over ~2 s after the first few frames (shader compiling) while the canvas is still
    // invisible; under 30 fps, stop and leave the still image. A hidden or off-screen pause restarts the measurement.
    frames++;
    if (frames === 5) { guardFrom = now; guardFrames = 0; }
    else if (frames > 5 && guardFrom >= 0) {
      guardFrames++;
      const span = now - guardFrom;
      if (span >= 2000) {
        guardFrom = -1;
        if ((guardFrames * 1000) / span < 30) return fail();
        if (!ready) { ready = true; opts.onReady(); } // only now does the canvas fade in over the still image
      }
    }
  };

  // Render only while the hero is on screen and the tab is visible.
  let onScreen = true;
  const sync = () => {
    const run = onScreen && !document.hidden;
    if (!run && guardFrom >= 0) frames = 0; // measure again from the next start
    renderer.setAnimationLoop(run ? tick : null);
  };
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); });
  io.observe(host);
  document.addEventListener("visibilitychange", sync);
  sync();

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    renderer.setAnimationLoop(null);
    io.disconnect(); ro.disconnect();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("pointermove", onMove);
    scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as MeshPhysicalMaterial | undefined;
      if (mat) { mat.roughnessMap?.dispose(); mat.alphaMap?.dispose(); mat.emissiveMap?.dispose(); (mat as unknown as PointsMaterial).map?.dispose?.(); mat.dispose(); }
    });
    scene.environment?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  function fail() { stop(); opts.onFail(); }
  return stop;
}
