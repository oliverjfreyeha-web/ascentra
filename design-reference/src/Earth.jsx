import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import dayUrl from "../tex/day.jpg";
import nightUrl from "../tex/night.jpg";
import waterUrl from "../tex/water.jpg";
import cloudUrl from "../tex/clouds.jpg";

const ll = (lat, lon, r = 1) => { const p = (90 - lat) * Math.PI / 180, t = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); };
const CITIES = [[47.8, -122.1], [40.7, -74], [51.5, -0.1], [35.7, 139.7], [-33.9, 151.2], [19.4, -99.1], [-23.5, -46.6], [28.6, 77.2], [1.35, 103.8], [30, 31.2]];
const SUN = new THREE.Vector3(-0.75, 0.3, 0.85).normalize();

const earthVS = `varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 wp=modelMatrix*vec4(position,1.);vV=normalize(cameraPosition-wp.xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`;
const earthFS = `uniform sampler2D dayT,nightT,waterT;uniform vec3 sun;uniform float gray;varying vec2 vUv;varying vec3 vN;varying vec3 vV;
void main(){vec3 N=normalize(vN);vec3 d=texture2D(dayT,vUv).rgb;vec3 n=texture2D(nightT,vUv).rgb;float w=texture2D(waterT,vUv).r;
float ndl=dot(N,normalize(sun));float dm=smoothstep(-.12,.28,ndl);vec3 col;
if(gray<.5){vec3 lit=d*(.26+1.25*max(ndl,0.));vec3 city=n*vec3(1.6,1.2,.7)*2.4;col=mix(city+d*.035,lit,dm);
 vec3 R=reflect(-normalize(sun),N);float sp=pow(max(dot(R,vV),0.),48.)*w*.7*dm;col+=vec3(.9,.95,1.)*sp;}
else{vec3 land=vec3(.60,.63,.70)*(.38+.62*clamp(ndl*.6+.55,0.,1.));vec3 sea=vec3(.035,.04,.09)+vec3(.02,.03,.06)*max(ndl,0.);col=mix(land,sea,w);
 float edge=smoothstep(.0,.5,abs(texture2D(waterT,vUv+vec2(.0012,0.)).r-texture2D(waterT,vUv-vec2(.0012,0.)).r));col+=edge*vec3(.55,.62,.8)*.45;}
float fr=pow(1.-max(dot(N,vV),0.),3.);col+=fr*vec3(.45,.58,1.)*(.35+.5*dm);gl_FragColor=vec4(col,1.);}`;
const atmVS = `varying vec3 vN;varying vec3 vV;void main(){vN=normalize(mat3(modelMatrix)*normal);vec4 wp=modelMatrix*vec4(position,1.);vV=normalize(cameraPosition-wp.xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`;
const atmFS = `varying vec3 vN;varying vec3 vV;uniform vec3 sun;void main(){float f=pow(clamp(abs(dot(normalize(vN),vV))/.52,0.,1.),2.2);float l=.45+.55*clamp(dot(normalize(vN),normalize(sun))+.35,0.,1.);gl_FragColor=vec4(vec3(.45,.62,1.)*1.2,f*l*.95);}`;
const cloudFS = `uniform sampler2D cloudT;uniform vec3 sun;varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){float a=texture2D(cloudT,vUv).r;float ndl=dot(normalize(vN),normalize(sun));float l=.06+.94*smoothstep(-.1,.4,ndl);gl_FragColor=vec4(vec3(1.)*l,a*.78*(.15+.85*smoothstep(-.2,.3,ndl)));}`;

export default function Earth({ mode = "real", still = false, size = 420 }) {
  const host = useRef(null), api = useRef({});
  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;cursor:grab;touch-action:pan-y";
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 50); cam.position.set(0, 0, 5.1);
    const g = new THREE.Group(); g.rotation.x = .38; scene.add(g);
    const loader = new THREE.TextureLoader(); const tx = (u) => { const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const dayT = tx(dayUrl), nightT = tx(nightUrl), waterT = loader.load(waterUrl), cloudT = loader.load(cloudUrl);
    const earthMat = new THREE.ShaderMaterial({ vertexShader: earthVS, fragmentShader: earthFS, uniforms: { dayT: { value: dayT }, nightT: { value: nightT }, waterT: { value: waterT }, sun: { value: SUN }, gray: { value: 0 } } });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), earthMat); g.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 96), new THREE.ShaderMaterial({ vertexShader: earthVS, fragmentShader: `varying vec2 vUv;` === "" ? "" : cloudFS.replace("varying vec2 vUv;varying vec3 vN;varying vec3 vV;", "varying vec2 vUv;varying vec3 vN;varying vec3 vV;"), uniforms: { cloudT: { value: cloudT }, sun: { value: SUN } }, transparent: true, depthWrite: false })); g.add(clouds);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 64), new THREE.ShaderMaterial({ vertexShader: atmVS, fragmentShader: atmFS, uniforms: { sun: { value: SUN } }, transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(atm);
    // decorative arcs
    const arcs = [];
    for (let i = 1; i < 7; i++) {
      const a = ll(...CITIES[0]), b = ll(...CITIES[i]); const pts = [];
      for (let k = 0; k <= 48; k++) { const t = k / 48; const v = a.clone().lerp(b, t).normalize().multiplyScalar(1.004 + Math.sin(Math.PI * t) * (.1 + a.distanceTo(b) * .12)); pts.push(v); }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false })); line.userData = { n: pts.length, off: i * 9 }; g.add(line); arcs.push(line);
    }
    CITIES.forEach((c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.011, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); m.position.copy(ll(c[0], c[1], 1.006)); g.add(m); });
    // interaction
    let drag = null, vel = 0, ry = 3.1; const el2 = renderer.domElement;
    const dn = (e) => { drag = e.clientX; el2.style.cursor = "grabbing"; }, mv = (e) => { if (drag != null) { vel = (e.clientX - drag) * .006; drag = e.clientX; } }, up = () => { drag = null; el2.style.cursor = "grab"; };
    el2.addEventListener("pointerdown", dn); addEventListener("pointermove", mv); addEventListener("pointerup", up);
    const fit = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    let raf, t0 = performance.now();
    const loop = (now) => {
      const t = (now - t0) / 1000;
      if (!still) { if (drag == null) ry += .0022; ry += vel; vel *= .92; clouds.rotation.y = t * .012; }
      g.rotation.y = ry; earthMat.uniforms.gray.value = api.current.gray ? 1 : 0; clouds.visible = !api.current.gray;
      arcs.forEach(l => { const c = (t * 30 + l.userData.off) % (l.userData.n * 1.7); const n = l.userData.n; l.geometry.setDrawRange(Math.max(0, c - n * .7 | 0), Math.min(c, n) - Math.max(0, c - n * .7 | 0)); });
      renderer.render(scene, cam); if (!still) raf = requestAnimationFrame(loop);
    };
    const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    api.current.kick = kick; kick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); el2.removeEventListener("pointerdown", dn); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); renderer.dispose(); el.removeChild(el2); };
  }, [still]);
  api.current.gray = mode === "gray"; if (api.current.kick && still) api.current.kick();
  return <div ref={host} style={{ width: "100%", aspectRatio: "1", maxWidth: size }} aria-label="Earth" role="img" />;
}
