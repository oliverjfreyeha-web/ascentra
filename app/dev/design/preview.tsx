"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyPrefs, EFFECTS, EFFECTS_LABEL, GLASSES, MOTION_LABEL, MOTIONS, readPrefs, THEME_LABEL, THEMES, writePref, type Prefs } from "../../env/prefs";
import { Icon, ICON_NAMES } from "../../ui/design/ds-icon";
import { Button } from "../../ui/design/button";
import { uiSounds } from "../../ui/sound/ui-sounds";
import { PrimitivesSection } from "./primitives";

const COLORS = ["--color-base", "--color-surface", "--color-raised", "--color-ink", "--color-ink-muted", "--color-frost", "--color-accent", "--color-text", "--color-text-muted", "--color-ok", "--color-gold", "--color-gold-soft"];
const ACCENTS = ["--accent-1", "--accent-2", "--accent-3", "--accent-4", "--accent-5", "--widget-streak", "--widget-points", "--widget-rank", "--widget-next"];
const ACTIVITY: [string, string][] = [["--activity-rest", "Rest"], ["--activity-miss", "Missed"], ["--activity-short", "Short"], ["--activity-steady", "Steady"], ["--activity-focus", "Focused"], ["--activity-grind", "Grind"]];
const TYPE: [string, string][] = [["--text-display", "Display"], ["--text-3xl", "3xl · 48"], ["--text-2xl", "2xl · 36"], ["--text-xl", "xl · 28"], ["--text-lg", "lg · 22"]];
const SCALE = ["--radius-glass-sm", "--radius-glass", "--radius-glass-lg", "--blur-hud", "--blur-panel", "--blur-liquid", "--blur-fallback", "--glass-saturate", "--ease-glide", "--duration-press", "--duration-hover", "--duration-enter", "--duration-icon", "--scale-press", "--tilt-max", "--z-scene", "--z-base", "--z-raised", "--z-sticky", "--z-hud", "--z-dropdown", "--z-popover", "--z-overlay", "--z-modal", "--z-toast", "--z-reward"];

/** Fills every [data-token] inside `root` with that custom property's current value there. */
function useTokenValues(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fill = () => {
      for (const c of el.querySelectorAll<HTMLElement>("[data-token]")) {
        c.textContent = getComputedStyle(c).getPropertyValue(c.dataset.token ?? "").trim() || "(unset)";
      }
    };
    fill();
    const mo = new MutationObserver(fill);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-reduced", "data-glass"] });
    return () => mo.disconnect();
  }, [dep]);
  return ref;
}

function Swatch({ token, label }: { token: string; label?: string }) {
  return (
    <li className="dp-swatch">
      <span className="dp-swatch__chip" style={{ background: `var(${token})` }} />
      <span className="dp-swatch__name">{label ?? token}</span>
      <code data-token={token} />
    </li>
  );
}

function Board({ theme }: { theme: (typeof THEMES)[number] }) {
  const ref = useTokenValues(theme);
  return (
    <div ref={ref} className="dp-board" data-theme={theme}>
      <div className="dp-board__light" aria-hidden="true" />
      <header>
        <p className="ds-caps">Theme</p>
        <h2 className="ds-display dp-board__title">{THEME_LABEL[theme]}</h2>
      </header>

      <section aria-label={`${THEME_LABEL[theme]} colors`}>
        <h3 className="ds-caps">Colors</h3>
        <ul className="dp-swatches">{COLORS.map((t) => <Swatch key={t} token={t} />)}</ul>
        <h3 className="ds-caps">Accents and widgets</h3>
        <ul className="dp-swatches">{ACCENTS.map((t) => <Swatch key={t} token={t} />)}</ul>
        <h3 className="ds-caps">Activity levels (points per day)</h3>
        <ul className="dp-swatches">{ACTIVITY.map(([t, l]) => <Swatch key={t} token={t} label={`${l} · ${t}`} />)}</ul>
      </section>

      <section aria-label={`${THEME_LABEL[theme]} type`}>
        <h3 className="ds-caps">Type</h3>
        {TYPE.map(([t, l]) => (
          <p key={t} className="dp-type"><span className="ds-display" style={{ fontSize: `var(${t})` }}>Cold outreach</span><small>{l}</small></p>
        ))}
        <p className="dp-type"><span className="ds-num dp-big">1,240</span><small>Big number · ds-num</small></p>
        <p className="dp-type"><span className="ds-caps">Day streak</span><small>Small-caps label · ds-caps</small></p>
        <p className="dp-body">Body text stays Geist. Learn how a first message works, the rules that apply, and how to practice safely with made-up businesses.</p>
        <p className="dp-body dp-body--muted">Muted body text, at least 4.5:1 on every surface. Round 1 · Section 2 of 5.</p>
      </section>

      <section aria-label={`${THEME_LABEL[theme]} surfaces`}>
        <h3 className="ds-caps">Glass, buttons, tilt</h3>
        <div className="dp-glass">
          <p className="ds-caps">Up next</p>
          <p className="dp-glass__title">Section 2 · Cold email</p>
          <div className="dp-row">
            <button type="button" className="dp-btn"><Icon name="book" size={18} /> Continue</button>
            <div className="dp-seg" role="group" aria-label="Example segmented control">
              <button type="button" aria-pressed="true">Iris</button>
              <button type="button" aria-pressed="false">Mono</button>
            </div>
          </div>
        </div>
        <div className="dp-row">
          <button type="button" className="dp-tile"><Icon name="mail" size={22} /><span>Clickable tile</span><small>tilts up to --tilt-max</small></button>
          <div className="dp-widget"><Icon name="flame" size={22} /><span>Widget</span><small>never tilts</small></div>
        </div>
      </section>

      <section aria-label={`${THEME_LABEL[theme]} icons`}>
        <h3 className="ds-caps">Icons ({ICON_NAMES.length}) · hover or focus one</h3>
        <ul className="dp-icons">
          {ICON_NAMES.map((n) => (
            <li key={n}><button type="button" className="dp-icon"><Icon name={n} size={24} /><small>{n}</small></button></li>
          ))}
        </ul>
      </section>

      <PrimitivesSection theme={THEME_LABEL[theme]} />

      <section aria-label={`${THEME_LABEL[theme]} scale`}>
        <h3 className="ds-caps">Radii, blur, motion, layers</h3>
        <dl className="dp-scale">{SCALE.map((t) => <div key={t}><dt>{t}</dt><dd><code data-token={t} /></dd></div>)}</dl>
      </section>
    </div>
  );
}

export function DesignPreview() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [reduced, setReduced] = useState("");
  const [lite, setLite] = useState("");
  const sounds = uiSounds();
  const soundOn = useSyncExternalStore(sounds?.subscribe ?? (() => () => {}), () => sounds?.enabled ?? false, () => false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this browser's saved choice after hydration
    setPrefs(readPrefs());
    const sync = () => {
      setReduced(document.documentElement.getAttribute("data-reduced") ?? "");
      setLite(document.documentElement.getAttribute("data-lite") ?? "");
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced", "data-lite"] });
    return () => mo.disconnect();
  }, []);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    const next = { ...(prefs ?? readPrefs()), [k]: v };
    writePref(k, v);
    applyPrefs(next);
    setPrefs(next);
  };
  const seg = <K extends "theme" | "glass" | "motion" | "effects">(k: K, list: readonly Prefs[K][], label: (v: Prefs[K]) => string) => (
    <div className="dp-seg" role="group" aria-label={k[0].toUpperCase() + k.slice(1)}>
      {list.map((v) => <button key={v} type="button" aria-pressed={prefs?.[k] === v} onClick={() => set(k, v)}>{label(v)}</button>)}
    </div>
  );
  return (
    <main className="ui-main-wide dp">
      <header className="dp-head">
        <p className="ds-caps">Preview · not linked from the product · dev and preview builds only</p>
        <h1 className="ds-display">Design system</h1>
        <p className="dp-body">Design rebuild D1 foundations. Both themes are shown side by side below. The controls change this whole page and are saved in this browser, exactly like the real preferences.</p>
        <div className="dp-controls">
          <div className="dp-control"><span className="ds-caps">Theme</span>{seg("theme", THEMES, (v) => THEME_LABEL[v])}</div>
          <div className="dp-control"><span className="ds-caps">Glass</span>{seg("glass", GLASSES, (v) => (v === "frost" ? "Frosted" : "Liquid"))}</div>
          <div className="dp-control"><span className="ds-caps">Motion</span>{seg("motion", MOTIONS, (v) => MOTION_LABEL[v])}</div>
          <div className="dp-control"><span className="ds-caps">Effects</span>{seg("effects", EFFECTS, (v) => EFFECTS_LABEL[v])}</div>
          <div className="dp-control"><span className="ds-caps">UI sounds</span>
            <div className="ds-seg" role="group" aria-label="UI sounds">
              <button type="button" className="ds-seg__opt" aria-pressed={soundOn} onClick={() => sounds?.setEnabled(true)}>On</button>
              <button type="button" className="ds-seg__opt" aria-pressed={!soundOn} onClick={() => sounds?.setEnabled(false)}>Off</button>
            </div>
          </div>
          <Button size="sm" icon="star" sfx="none" onClick={() => sounds?.reward()}>Play reward sound</Button>
          <p className="dp-body dp-body--muted">html[data-reduced] = <code>{reduced || "…"}</code> (also &quot;1&quot; when the device asks for reduced motion) · html[data-lite] = <code>{lite || "…"}</code> (phones, 4 or fewer cores, Save-Data; &quot;Always full&quot; overrides).</p>
        </div>
      </header>
      <div className="dp-boards">
        <Board theme="iris" />
        <Board theme="mono" />
      </div>
    </main>
  );
}
