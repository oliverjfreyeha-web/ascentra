"use client";

import { useEffect, useRef, useState } from "react";

// A slow field of light in Black Iris and Frozen: layered value noise, drifting. Tiny raw WebGL, no library.
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<4;k++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*.85;float s=t*.022;
vec2 q=vec2(fbm(p+vec2(0.,s)),fbm(p+vec2(5.2,1.3)-s*.7));
float w=fbm(p*.9+.85*q+vec2(s*.4,-s*.2))+uv.y*.35;
float g=fract(w*13.);float lines=smoothstep(.09,0.,min(g,1.-g));
float field=smoothstep(.45,1.05,w);
float d=length((uv-vec2(.74,.66))*vec2(1.,1.35));float focus=smoothstep(.95,.0,d);
vec3 base=vec3(.031,.031,.075);vec3 frost=vec3(.627,.741,.859);vec3 iris=vec3(.42,.38,.7);
vec3 c=base+frost*field*.2*focus+frost*lines*(.07+.16*focus)*(.35+.65*field)+iris*q.x*q.y*.1*focus;
c+=frost*.035*smoothstep(.55,1.,uv.y);
gl_FragColor=vec4(c,1.);}`;
const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

function lowPower() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return !!nav.connection?.saveData || (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
}

/**
 * D2b: the landing hero's living background. Starts after first paint (the headline is the largest paint), renders at
 * reduced resolution and about 30 fps, pauses when off-screen or the tab is hidden, and shows a still image instead with
 * reduced motion, a low-power device, Save-Data, or no WebGL. Decorative: hidden from assistive tech.
 */
export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches || lowPower()) return;
    let raf = 0, idle = 0, visible = true, running = false, start = 0, lastDraw = 0;
    let gl: WebGLRenderingContext | null = null;
    let uR: WebGLUniformLocation | null = null, uT: WebGLUniformLocation | null = null;
    const size = () => {
      if (!gl || !canvas) return;
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uR, canvas.width, canvas.height);
    };
    const frame = (now: number) => {
      raf = 0;
      if (!gl || !running) return;
      if (now - lastDraw > 33) {
        lastDraw = now;
        gl.uniform1f(uT, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(frame);
    };
    const update = () => {
      const should = !!gl && visible && document.visibilityState === "visible";
      if (should && !running) { running = true; raf = requestAnimationFrame(frame); }
      if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
    const init = () => {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
      if (!gl) return;
      const sh = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); return s; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return; }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      uR = gl.getUniformLocation(prog, "r");
      uT = gl.getUniformLocation(prog, "t");
      start = performance.now() - 40_000; // start mid-drift, not from a blank field
      size();
      setLive(true);
      update();
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); });
    io.observe(canvas);
    const onVis = () => update();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", size);
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    idle = ric ? ric(init, { timeout: 1200 }) : window.setTimeout(init, 300);
    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cic) cic(idle); else clearTimeout(idle);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", size);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div className="hero-bg" aria-hidden="true">
      <div className="hero-bg__still" />
      <canvas ref={ref} className="hero-bg__canvas" data-live={live || undefined} />
    </div>
  );
}
