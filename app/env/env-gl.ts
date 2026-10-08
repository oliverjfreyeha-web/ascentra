/**
 * D5 · Live wallpaper: one WebGL context for the whole app (mounted once by app/env/env-root.tsx, loaded only after
 * the page is idle and only where a wallpaper shows) plus a 2D canvas of drifting particles: bubbles on the Reef,
 * ice motes elsewhere. Ported from the approved prototype (Appendix A) with three changes for safety and speed:
 *   - a 30 fps cap; drawing pauses while the tab is hidden, a dialog covers the page, or the page is scrolled far down
 *   - every sparkle and glint repeats no faster than once every 6 s (never more than 3 flashes a second)
 *   - if frames take longer than 40 ms on average for 2 s, it reports "slow" and the caller switches to the still photo
 * With reduced motion it draws one still frame and stops.
 */
export type EnvScene = "reef" | "lake" | "mist" | "sun";
const INDEX: Record<EnvScene, number> = { reef: 0, lake: 1, mist: 2, sun: 3 };

const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FS = [
  "precision highp float;uniform sampler2D T;uniform vec2 R,I;uniform float t,S;",
  "float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
  "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}",
  "float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return s;}",
  "float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}",
  "void main(){",
  " vec2 q=gl_FragCoord.xy/R;q.y=1.-q.y;",
  " float sc=max(R.x/I.x,R.y/I.y)*1.09;vec2 ext=I*sc/R;",
  " vec2 uv=(q-.5)/ext+.5;",
  " uv+=vec2(sin(t*.05)*.011,cos(t*.04)*.007);",
  " vec2 p=uv;vec3 c;",
  " if(S<.5){",
  "  vec2 d=(vec2(fbm(p*vec2(26.,15.)+vec2(t*.1,t*.07)),fbm(p*vec2(26.,15.)+7.+vec2(-t*.09,t*.11)))-.5)*.013;",
  "  c=texture2D(T,uv+d).rgb;",
  "  float wm=smoothstep(.0,.18,c.b-c.r*.9);",
  "  float cau=pow(1.-abs(fbm(p*vec2(34.,19.)+vec2(t*.06,-t*.05))-.5)*2.,7.);",
  "  c+=vec3(.35,.8,.9)*cau*.24*wm;",
  "  float gr=smoothstep(.25,1.,p.x*.7+p.y*.75);",
  "  vec2 g=floor(p*vec2(520.,290.));float gh=h(g);",
  // glints: angular speed at most 1 rad/s, so each repeats every 6.28 s or slower (photosensitivity)
  "  float tw=max(0.,sin(t*(.5+.5*gh)+gh*40.));",
  "  float sp=step(.9935,gh)*tw*gr*wm;",
  "  c+=vec3(1.)*sp*.7;",
  "  c*=1.-.14*smoothstep(.5,.78,fbm(p*vec2(2.2,3.)+vec2(t*.012,t*.004)));",
  " }else if(S<1.5){",
  "  float m=smoothstep(.69,.74,p.y);",
  "  vec2 d=vec2((fbm(vec2(p.x*34.,p.y*150.+t*.32))-.5)*.015,(fbm(vec2(p.x*20.+9.,p.y*90.-t*.26))-.5)*.0035)*m;",
  "  d+=vec2((fbm(p*vec2(3.,5.)+vec2(t*.01,0.))-.5)*.004,0.)*(1.-m);",
  "  c=texture2D(T,uv+d).rgb;",
  "  float st=pow(fbm(vec2(p.x*18.,p.y*210.-t*.28)),5.)*m*2.4;",
  "  c+=vec3(1.,.86,.7)*st*.35*(.3+lum(c));",
  "  float wr=smoothstep(.04,.3,c.r-c.b);",
  "  c+=c*wr*.16*(.5+.5*sin(t*.35));",
  "  float band=smoothstep(.55,.7,p.y)*(1.-smoothstep(.78,.92,p.y));",
  "  float fg=fbm(p*vec2(3.5,6.)+vec2(t*.012,-t*.014));",
  "  c=mix(c,vec3(.78,.87,.95),smoothstep(.4,.8,fg)*.16*band);",
  " }else if(S<2.5){",
  "  vec2 d=vec2((fbm(p*vec2(5.,8.)+vec2(-t*.03,t*.01))-.5)*.006,(fbm(p*vec2(6.,9.)+3.+vec2(-t*.025,0.))-.5)*.004);",
  "  c=texture2D(T,uv+d).rgb;",
  "  float f1=fbm(p*vec2(2.4,3.6)+vec2(-t*.034,t*.006));",
  "  float f2=fbm(p*vec2(4.6,7.)+vec2(-t*.06,t*.009)+5.);",
  "  float fa=f1*.6+f2*.4;",
  "  float lowm=.55+.45*smoothstep(.3,.8,p.y);",
  "  c=mix(c,vec3(.58,.68,.78),smoothstep(.42,.82,fa)*.44*lowm);",
  "  vec2 lp=p-vec2(.715+.012*sin(t*.17),.22);",
  "  float patch=exp(-dot(lp*vec2(1.,1.7),lp*vec2(1.,1.7))*26.)*(.55+.45*sin(t*.28));",
  "  c+=vec3(1.,.5,.2)*patch*.2;",
  "  float wr=smoothstep(.04,.3,c.r-c.b);c+=c*wr*.12*(.5+.5*sin(t*.31+1.));",
  "  c*=1.-.12*smoothstep(.55,.82,fbm(p*vec2(1.8,2.6)+vec2(-t*.015,0.)));",
  " }else{",
  "  vec2 d=vec2((fbm(p*vec2(7.,10.)+vec2(t*.02,0.))-.5)*.0035,0.);",
  "  c=texture2D(T,uv+d).rgb;",
  "  vec2 sun=vec2(.905,.075);vec2 dd=p-sun;dd.y*=I.y/I.x*2.2;",
  "  float r=length(dd);float ang=atan(dd.y,dd.x);",
  "  float breath=.65+.35*sin(t*.42);",
  "  float rays=pow(fbm(vec2(ang*5.+t*.04,r*2.5)),2.2)*exp(-r*2.6)*breath;",
  "  float glow=exp(-r*7.)*.8+exp(-r*2.2)*.22;",
  "  c+=vec3(1.,.74,.42)*(glow*.5+rays*.7);",
  "  vec2 gp=sun+(vec2(.5,.45)-sun)*(1.35+.04*sin(t*.2));",
  "  c+=vec3(.35,.85,.7)*smoothstep(.034,.0,length((p-gp)*vec2(1.,I.y/I.x*2.2)))*.09*breath;",
  "  c+=vec3(1.,.8,.55)*smoothstep(.016,.0,length((p-(sun+(vec2(.5,.45)-sun)*.55))*vec2(1.,I.y/I.x*2.2)))*.06*breath;",
  "  float vm=smoothstep(.42,.6,p.y)*(1.-smoothstep(.78,.95,p.y));",
  "  float vf=fbm(vec2(p.x*3.2-t*.018,p.y*14.)+vec2(0.,t*.004));",
  "  c=mix(c,vec3(.74,.8,.84),smoothstep(.5,.85,vf)*.22*vm);",
  " }",
  " vec2 v=q-.5;c*=1.-dot(v,v)*.55;",
  " c+=(h(gl_FragCoord.xy+t*60.)-.5)*.018;",
  " gl_FragColor=vec4(c,1.);",
  "}",
].join("\n");

/** The smallest repeat period (seconds) of any sparkle or glint in the shader and particles: kept for the tests. */
export const MIN_GLINT_PERIOD_S = (2 * Math.PI) / 1.0;
const PARTICLE_PULSE_MS = 2000; // |sin(now / 2000)| repeats every 2000·π ms ≈ 6.3 s

export type EnvHandle = { setScene(s: EnvScene): void; destroy(): void };

export function imageUrl(scene: EnvScene, width: number): string {
  return `/env/${scene}-${width < 900 ? 1080 : 1920}.webp`;
}

export function mountEnv(host: HTMLElement, opts: { scene: EnvScene; reduce: boolean; onReady(): void; onSlow(): void }): EnvHandle {
  const cv = document.createElement("canvas");
  const pt = document.createElement("canvas");
  cv.className = "env__gl"; pt.className = "env__pt";
  cv.setAttribute("aria-hidden", "true"); pt.setAttribute("aria-hidden", "true");
  const gl = cv.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  if (!gl) throw new Error("no webgl");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(["T", "R", "I", "t", "S"].map((k) => [k, gl.getUniformLocation(prog, k)]));
  host.append(cv, pt);

  let scene = opts.scene, tex: WebGLTexture | null = null, img: HTMLImageElement | null = null, token = 0;
  let destroyed = false, frame = 0, last = 0, ready = false;
  const T0 = performance.now();
  const glDpr = () => Math.min(window.devicePixelRatio || 1, 1.5);
  const ptDpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const px = pt.getContext("2d")!;
  let W = 0, H = 0;
  const size = () => {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * glDpr()); cv.height = Math.round(H * glDpr());
    gl.viewport(0, 0, cv.width, cv.height);
    pt.width = Math.round(W * ptDpr()); pt.height = Math.round(H * ptDpr());
    px.setTransform(ptDpr(), 0, 0, ptDpr(), 0, 0);
    if (ready) draw(performance.now(), true);
  };

  const load = (s: EnvScene) => {
    const my = ++token;
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (destroyed || my !== token) return;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      if (tex) gl.deleteTexture(tex);
      tex = t; img = im; scene = s;
      if (!ready) { ready = true; size(); opts.onReady(); }
      draw(performance.now(), true);
      wake();
    };
    im.src = imageUrl(s, window.innerWidth); // the same file the poster already shows: served from cache
  };

  // ── particles ──
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const sg = sprite.getContext("2d")!, rg = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, "rgba(255,255,255,.95)"); rg.addColorStop(0.35, "rgba(255,255,255,.35)"); rg.addColorStop(1, "rgba(255,255,255,0)");
  sg.fillStyle = rg; sg.fillRect(0, 0, 32, 32);
  const P = Array.from({ length: 54 }, () => ({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75, p: Math.random() * 6.28 }));
  let lt = 0;
  const particles = (now: number) => {
    const dt = Math.min(0.06, (now - lt) / 1000 || 0.033);
    lt = now;
    px.clearRect(0, 0, W, H);
    for (const q of P) {
      if (scene === "reef") {
        q.y -= dt * 0.035 * q.z; q.x += Math.sin(now / 1700 + q.p) * dt * 0.012;
        if (q.y < -0.05) { q.y = 1.05; q.x = Math.random(); }
        const s = 3 + q.z * 9;
        px.globalAlpha = 0.22 * q.z; px.strokeStyle = "#d8f4ff"; px.lineWidth = 1;
        px.beginPath(); px.arc(q.x * W, q.y * H, s * 0.5, 0, 6.283); px.stroke();
        px.globalAlpha = 0.1 * q.z; px.drawImage(sprite, q.x * W - s * 0.4, q.y * H - s * 0.4, s * 0.8, s * 0.8);
      } else {
        q.x += dt * (0.006 + 0.012 * q.z) * (scene === "sun" ? 1 : -1);
        q.y += dt * (0.004 + 0.006 * q.z) + Math.sin(now / 2300 + q.p) * dt * 0.004;
        if (q.x < -0.05) q.x = 1.05; if (q.x > 1.05) q.x = -0.05; if (q.y > 1.05) { q.y = -0.05; q.x = Math.random(); }
        const s2 = 4 + q.z * 14;
        px.globalAlpha = (0.3 + 0.4 * Math.abs(Math.sin(now / PARTICLE_PULSE_MS + q.p))) * q.z * 0.8;
        px.drawImage(sprite, q.x * W - s2 / 2, q.y * H - s2 / 2, s2, s2);
      }
    }
    px.globalAlpha = 1;
  };

  const draw = (now: number, still = false) => {
    if (!tex || !img) return;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.T, 0);
    gl.uniform2f(U.R, cv.width, cv.height); gl.uniform2f(U.I, img.naturalWidth, img.naturalHeight);
    gl.uniform1f(U.t, opts.reduce ? 20 : (now - T0) / 1000); gl.uniform1f(U.S, INDEX[scene]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!still || opts.reduce) particles(now);
  };

  // ── pausing and the slow-device check ──
  const covered = () => !!document.querySelector("dialog[open]");
  const running = () => !destroyed && ready && !opts.reduce && !document.hidden && !covered() && window.scrollY < window.innerHeight * 1.5;
  // Slow-device check: every browser frame (not only the frames this draws) over a rolling 2 s window. If they average
  // more than 40 ms, the page is struggling (the wallpaper plus everything over it), so hand over to the still photo.
  let winStart = 0, sum = 0, count = 0, prev = 0;
  const loop = (now: number) => {
    frame = 0;
    if (!running()) { prev = 0; winStart = 0; sum = 0; count = 0; return; } // stops; wake() restarts it
    frame = requestAnimationFrame(loop);
    if (prev) {
      sum += now - prev; count++;
      if (!winStart) winStart = now;
      if (now - winStart >= 2000) {
        if (sum / count > 40) { opts.onSlow(); return; }
        winStart = now; sum = 0; count = 0;
      }
    }
    prev = now;
    if (now - last < 33) return; // 30 fps cap
    last = now;
    draw(now);
  };
  const wake = () => { if (!frame && running()) frame = requestAnimationFrame(loop); };
  const onScroll = () => wake();
  const onVis = () => wake();
  const poll = window.setInterval(wake, 1000); // a dialog closing, scrolling back up
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", size);
  let dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onDpr = () => { dprQuery.removeEventListener("change", onDpr); dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); dprQuery.addEventListener("change", onDpr); size(); };
  dprQuery.addEventListener("change", onDpr);
  size();
  load(scene);

  return {
    setScene(s) { if (s !== scene || !tex) load(s); },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", size);
      dprQuery.removeEventListener("change", onDpr);
      if (tex) gl.deleteTexture(tex);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      cv.remove(); pt.remove();
    },
  };
}
