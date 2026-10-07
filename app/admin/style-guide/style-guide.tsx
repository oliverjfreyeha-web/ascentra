"use client";

import { useEffect, useState, type ReactNode } from "react";
import { meFrom } from "../../me";
import { BACKGROUNDS, CONTROL_BORDERS, DEPTH_SURFACES, PALETTE, TEXT_COLORS, contrast, type PaletteName } from "../../ui/palette";
import { STATUS_TEXT, StatusLabel, type StatusState } from "../../ui/status-label";
import { Tabs } from "../../ui/tabs";
import { Menu } from "../../ui/menu";
import { Modal } from "../../ui/modal";
import { Toasts, useToasts } from "../../ui/toasts";
import { ICON_NAMES, Icon } from "../../ui/icons";
import { ArtSlot } from "../../ui/art-slot";

// Everything on this page is sample data: no request other than the role check, nothing is saved.
const TYPE_SCALE = [
  ["text-display", "Display", "var(--font-display)"], ["text-3xl", "48 · 3rem", ""], ["text-2xl", "36 · 2.25rem", ""], ["text-xl", "28 · 1.75rem", ""],
  ["text-lg", "22 · 1.375rem", ""], ["text-md", "18 · 1.125rem", ""], ["text-base", "16 · 1rem", ""], ["text-sm", "14 · 0.875rem", ""], ["text-xs", "12 · 0.75rem", ""],
] as const;
const SPACES = ["space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-7", "space-8", "space-9"];
const RADII = ["radius-xs", "radius-sm", "radius-md", "radius-lg", "radius-pill"];
const SHADOWS = ["shadow-1", "shadow-2", "shadow-3"];
const BLURS = ["blur-sm", "blur-md", "blur-lg"];
const DURATIONS = ["duration-micro", "duration-quick", "duration-fast", "duration-medium", "duration-slow", "duration-very-slow"];
const EASINGS = ["ease-smooth-out", "ease-in-out", "ease-out", "ease-linear"];
const LAYERS = [["z-base", 0], ["z-raised", 10], ["z-sticky", 100], ["z-dropdown", 200], ["z-overlay", 300], ["z-modal", 400], ["z-toast", 500]] as const;
const STATES = Object.keys(STATUS_TEXT) as StatusState[];
const SAMPLE_ROWS = [
  { name: "Sample course A", lessons: 12, updated: "2026-09-01", state: "published" as const },
  { name: "Sample course B", lessons: 4, updated: "2026-09-18", state: "draft" as const },
  { name: "Sample course C", lessons: 0, updated: "2026-10-02", state: "failed" as const },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="sg-section">
      <h2 id={id}>{title}</h2>
      {note && <p className="muted">{note}</p>}
      {children}
    </section>
  );
}

export function StyleGuide() {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [modal, setModal] = useState(false);
  const [checked, setChecked] = useState(true);
  const [motionKey, setMotionKey] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
  }, []);

  if (role === undefined) return <p className="muted">Checking your account…</p>;
  if (role !== "owner" && role !== "superAdmin") return <p>The style guide is for the Owner and Super Admins.</p>;

  return (
    <div className="sg">
      <header className="sg-hero ui-panel">
        <p className="ui-eyebrow">ASCENTRA · Design system · D1</p>
        <h1 className="ui-display">Style guide</h1>
        <p className="muted" style={{ maxWidth: "38rem", fontSize: "var(--text-md)" }}>
          Every token and base component in one place. All names, numbers and states on this page are sample data; nothing here is live.
        </p>
        <nav aria-label="Sections" className="ui-row">
          {["Fonts", "Color", "Contrast", "Type", "Space", "Shape", "Motion", "Buttons", "Forms", "Surfaces", "Overlays", "Status", "Data", "Feedback", "Depth", "Learner"].map((s) => (
            <a key={s} href={`#sg-${s.toLowerCase()}`} className="ui-badge">{s}</a>
          ))}
        </nav>
      </header>

      <Section id="sg-fonts" title="Font comparison (D2c)"
        note="Three headline pairings, set with real ASCENTRA text. The default is still A. To switch, change the one token --font-headline in app/styles/tokens.css (the comment there lists the values).">
        <div className="font-compare">
          {([["A", "Current: Instrument Serif headlines + Geist"], ["B", "Sora headings + Geist"], ["C", "Bricolage Grotesque headings, Instrument Serif italic accents + Geist"]] as const).map(([k, name]) => (
            <article key={k} className="ui-tile font-compare__card" data-pair={k}>
              <p className="ui-label"><span className="ui-num">{k}</span> / {name}</p>
              <p className="font-compare__hero">ASCENTRA · <em>Foundations</em> in progress</p>
              <p className="font-compare__section">Learning you can <em>check</em>.</p>
              <p className="muted">Courses written from reviewed sources. Each lesson cites them, marks anything without one, and shows when it was last verified.</p>
              <p className="ui-row"><button type="button" className="ui-btn ui-btn--primary">Create an account</button></p>
              <p className="ui-label"><span className="ui-num">01</span> / Lessons</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="sg-color" title="Color" note="Dark first. Black Iris is the page, Frozen is the accent; the shades between were derived from them.">
        <div className="ui-grid">
          {(Object.keys(PALETTE) as PaletteName[]).map((name) => (
            <div key={name} className="sg-swatch">
              <span className="sg-chip" style={{ background: `var(--${name})` }} />
              <code>--{name}</code>
              <span className="muted">{PALETTE[name]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="sg-contrast" title="Contrast" note="Every text color on every background (at least 4.5:1), and control borders (at least 3:1).">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <caption>WCAG 2 contrast ratios, computed from the token values.</caption>
            <thead><tr><th scope="col">Foreground</th>{BACKGROUNDS.map((b) => <th key={b} scope="col">on {b.replace("color-", "")}</th>)}</tr></thead>
            <tbody>
              {[...TEXT_COLORS, ...CONTROL_BORDERS].map((f) => (
                <tr key={f}>
                  <th scope="row" style={{ color: `var(--${f})` }}>{f.replace("color-", "")}</th>
                  {BACKGROUNDS.map((b) => {
                    const r = contrast(PALETTE[f], PALETTE[b]);
                    const min = CONTROL_BORDERS.includes(f) ? 3 : 4.5;
                    return <td key={b} className="num" style={{ background: `var(--${b})`, color: `var(--${f})` }}>{r.toFixed(2)}:1 {r >= min ? "✓" : "✕"}</td>;
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row">on-accent text</th>
                <td className="num" colSpan={3} style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}>{contrast(PALETTE["color-on-accent"], PALETTE["color-accent"]).toFixed(2)}:1 ✓</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="sg-type" title="Type" note="Geist for the interface, Geist Mono for numbers and IDs, Instrument Serif for big display headings only.">
        <div className="ui-stack">
          {TYPE_SCALE.map(([token, size, family]) => (
            <div key={token} className="sg-type-row">
              <code className="muted">--{token}</code>
              <span style={{ fontSize: `var(--${token})`, fontFamily: family || undefined, lineHeight: "var(--leading-tight)" }}>Learn by doing · {size}</span>
            </div>
          ))}
          <p style={{ fontFamily: "var(--font-mono)" }}>Geist Mono · 0123456789 · a1b2c3d4e5f6</p>
        </div>
      </Section>

      <Section id="sg-space" title="Spacing" note="A 4px grid. Generous by default: sections use space-6 and up.">
        <div className="ui-stack">
          {SPACES.map((s) => (
            <div key={s} className="sg-space-row"><code className="muted">--{s}</code><span className="sg-bar" style={{ width: `var(--${s})` }} /></div>
          ))}
        </div>
      </Section>

      <Section id="sg-shape" title="Radii, borders, blur and shadows">
        <div className="ui-grid">
          {RADII.map((r) => <div key={r} className="sg-tile" style={{ borderRadius: `var(--${r})` }}><code>--{r}</code></div>)}
          <div className="sg-tile" style={{ border: "var(--border-hairline)" }}><code>--border-hairline</code></div>
          <div className="sg-tile" style={{ border: "var(--border-control)" }}><code>--border-control</code></div>
          <div className="sg-tile" style={{ border: "var(--border-glass)" }}><code>--border-glass</code></div>
          {SHADOWS.map((s) => <div key={s} className="sg-tile" style={{ boxShadow: `var(--${s})`, background: "var(--color-raised)" }}><code>--{s}</code></div>)}
        </div>
        <div className="sg-blur-stage ui-grid">
          {BLURS.map((b) => (
            <div key={b} className="sg-blur" style={{ backdropFilter: `blur(var(--${b}))`, WebkitBackdropFilter: `blur(var(--${b}))` }}><code>--{b}</code></div>
          ))}
        </div>
      </Section>

      <Section id="sg-motion" title="Motion" note="Durations and easings follow the transitions.dev scale. With reduced motion on, every duration is zero and the dots stay still.">
        <p><button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setMotionKey((k) => k + 1)}>Replay</button></p>
        <div className="ui-stack" key={motionKey}>
          {DURATIONS.map((d) => (
            <div key={d} className="sg-motion-row"><code className="muted">--{d}</code><span className="sg-track"><span className="sg-dot" style={{ animationDuration: `calc(var(--${d}) * 3)` }} /></span></div>
          ))}
          {EASINGS.map((e) => (
            <div key={e} className="sg-motion-row"><code className="muted">--{e}</code><span className="sg-track"><span className="sg-dot" style={{ animationTimingFunction: `var(--${e})`, animationDuration: "calc(var(--duration-very-slow) * 3)" }} /></span></div>
          ))}
        </div>
        <h3>Layers</h3>
        <p className="ui-row">{LAYERS.map(([n, v]) => <span key={n} className="ui-badge ui-badge--mono">--{n}: {v}</span>)}</p>
      </Section>

      <Section id="sg-buttons" title="Buttons" note="Hover, press and Tab to each one to see its states. The last column is disabled; error is shown on the secondary row.">
        <div className="ui-stack">
          {(["primary", "secondary", "quiet", "danger"] as const).map((v) => (
            <div key={v} className="ui-row">
              <code className="muted sg-label">{v}</code>
              <button type="button" className={`ui-btn ui-btn--${v}`}>Continue</button>
              <button type="button" className={`ui-btn ui-btn--${v} ui-btn--sm`}>Small</button>
              {v === "secondary" && <button type="button" className="ui-btn ui-btn--secondary is-error">Error</button>}
              <button type="button" className={`ui-btn ui-btn--${v}`} disabled>Disabled</button>
            </div>
          ))}
        </div>
      </Section>

      <Section id="sg-forms" title="Inputs, selects and checkboxes">
        <div className="ui-grid">
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-in1">Course name</label>
            <input id="sg-in1" className="ui-input" placeholder="e.g. Sample course" />
            <span className="ui-hint">Default. Focus to see the ring.</span>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-in2">Email</label>
            <input id="sg-in2" className="ui-input" defaultValue="not-an-email" aria-invalid="true" aria-describedby="sg-in2-err" />
            <span className="ui-error" id="sg-in2-err">Enter an email address like name@example.com.</span>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-in3">Locked field</label>
            <input id="sg-in3" className="ui-input" defaultValue="Read only sample" disabled />
            <span className="ui-hint">Disabled.</span>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-sel1">Level</label>
            <select id="sg-sel1" className="ui-select" defaultValue="b"><option value="b">Beginner</option><option value="i">Intermediate</option></select>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-sel2">Plan</label>
            <select id="sg-sel2" className="ui-select" aria-invalid="true" defaultValue=""><option value="">Choose a plan</option><option>Basic</option></select>
            <span className="ui-error">Choose a plan.</span>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="sg-ta">Note</label>
            <textarea id="sg-ta" className="ui-input" placeholder="A few words" />
          </div>
        </div>
        <div className="ui-row">
          <label className="ui-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Send me a weekly summary</label>
          <label className="ui-check"><input type="checkbox" /> Unchecked</label>
          <label className="ui-check"><input type="checkbox" aria-invalid="true" /> Required (error)</label>
          <label className="ui-check"><input type="checkbox" disabled defaultChecked /> Disabled</label>
        </div>
      </Section>

      <Section id="sg-surfaces" title="Tabs, cards and frosted panels">
        <Tabs label="Sample tabs" tabs={[
          { key: "a", label: "Overview", content: <p className="muted">Arrow keys move between tabs.</p> },
          { key: "b", label: "Lessons", content: <p className="muted">Sample lesson list.</p> },
          { key: "c", label: "Activity", content: <p className="muted">Sample activity.</p> },
          { key: "d", label: "Disabled", content: null, disabled: true },
        ]} />
        <div className="sg-glass-stage">
          <div className="ui-grid">
            <article className="ui-card">
              <p className="ui-eyebrow">Card</p>
              <h3 style={{ marginTop: 0 }}>Sample course A</h3>
              <p className="muted">A solid surface for content blocks.</p>
            </article>
            <a href="#sg-surfaces" className="ui-card ui-card--interactive" style={{ color: "inherit", textDecoration: "none" }}>
              <p className="ui-eyebrow">Interactive card</p>
              <h3 style={{ marginTop: 0 }}>Hover or focus me</h3>
              <p className="muted">Lifts a little; the border firms up.</p>
            </a>
            <article className="ui-panel">
              <p className="ui-eyebrow">Frosted panel</p>
              <h3 style={{ marginTop: 0 }}>Glass over the page</h3>
              <p className="muted">Translucent, softly blurred, thin cool edge.</p>
            </article>
            <article className="ui-card is-error">
              <p className="ui-eyebrow">Card · error</p>
              <h3 style={{ marginTop: 0 }}>Sample course C</h3>
              <p className="muted">Something needs attention.</p>
            </article>
          </div>
        </div>
      </Section>

      <Section id="sg-overlays" title="Modal, dropdown menu and toasts">
        <div className="ui-row">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setModal(true)}>Open modal</button>
          <Menu label="Actions" items={[
            { label: "Rename (sample)", onSelect: () => push("info", "Sample: rename chosen. Nothing was changed.") },
            { label: "Duplicate (sample)", onSelect: () => push("success", "Sample: a success toast. Nothing was changed.") },
            { label: "Unavailable", onSelect: () => undefined, disabled: true },
            { label: "Delete (sample)", onSelect: () => push("danger", "Sample: a danger toast. Nothing was deleted."), danger: true },
          ]} />
          <button type="button" className="ui-btn ui-btn--quiet" onClick={() => push("warning", "Sample warning toast.")}>Show a toast</button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Sample dialog" actions={
          <>
            <button type="button" className="ui-btn ui-btn--quiet" onClick={() => setModal(false)}>Cancel</button>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => setModal(false)}>Done</button>
          </>
        }>
          <p className="muted">Focus stays inside until it closes. Escape closes it. Nothing here is saved.</p>
        </Modal>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </Section>

      <Section id="sg-status" title="Badges and status labels"
        note="Every state has its own color and shape. A label always names its state from a real answer; nothing defaults to Connected or Verified.">
        <p className="ui-row">
          <span className="ui-badge">Basic</span><span className="ui-badge ui-badge--accent">Pro</span><span className="ui-badge ui-badge--mono">#1042</span><span className="ui-badge">3 open</span>
        </p>
        <p className="ui-row">{STATES.map((s) => <StatusLabel key={s} state={s} />)}</p>
      </Section>

      <Section id="sg-data" title="Table">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <caption>Sample data.</caption>
            <thead><tr><th scope="col">Course</th><th scope="col" className="num">Lessons</th><th scope="col">Updated</th><th scope="col">State</th></tr></thead>
            <tbody>
              {SAMPLE_ROWS.map((r) => (
                <tr key={r.name} className={r.state === "failed" ? "is-error" : undefined}>
                  <td>{r.name}</td><td className="num">{r.lessons}</td><td className="num">{r.updated}</td><td><StatusLabel state={r.state} /></td>
                </tr>
              ))}
              <tr aria-disabled="true"><td>Sample course D (archived)</td><td className="num">7</td><td className="num">2026-06-12</td><td><StatusLabel state="draft">Archived</StatusLabel></td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="sg-feedback" title="Banners, empty states and loading skeletons">
        <div className="ui-stack">
          <div className="ui-banner" role="note"><span className="ui-banner__mark" /><div><strong className="ui-banner__title">Information</strong>A neutral note about this page.</div></div>
          <div className="ui-banner ui-banner--success" role="note"><span className="ui-banner__mark" /><div><strong className="ui-banner__title">Saved</strong>A sample success message.</div></div>
          <div className="ui-banner ui-banner--warning" role="note"><span className="ui-banner__mark" /><div><strong className="ui-banner__title">Check this</strong>A sample warning.</div></div>
          <div className="ui-banner ui-banner--danger" role="alert"><span className="ui-banner__mark" /><div><strong className="ui-banner__title">Something went wrong</strong>A sample error.</div></div>
          <div className="ui-banner ui-banner--demo" role="note"><span className="ui-banner__mark" /><div><strong className="ui-banner__title">Demo</strong>A sample demo notice: data shown is not real.</div></div>
          <div className="ui-empty">
            <span className="ui-empty__art" aria-hidden="true" />
            <p className="ui-empty__title">Nothing here yet</p>
            <p>A sample empty state. Say what would appear here and the one next step.</p>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm">Next step</button>
          </div>
          <div className="ui-card ui-stack" aria-busy="true" aria-label="Loading sample">
            <span className="ui-skeleton ui-skeleton--title" />
            <span className="ui-skeleton" />
            <span className="ui-skeleton" style={{ width: "80%" }} />
            <div className="ui-row"><span className="ui-skeleton ui-skeleton--circle" /><span className="ui-skeleton" style={{ flex: 1 }} /></div>
            <span className="ui-skeleton ui-skeleton--block" />
          </div>
        </div>
      </Section>

      <Section id="sg-depth" title="Depth" note="Three elevation levels, frosted glass with a top-edge highlight, a faint grain over the page, and large, soft Frozen glows behind key areas.">
        <div className="sg-glass-stage">
          <div className="ui-grid">
            {["elev-1", "elev-2", "elev-3"].map((e) => (
              <div key={e} className="ui-card ui-card--raised" style={{ boxShadow: `var(--${e})` }}><code>--{e}</code></div>
            ))}
            <div className="ui-panel"><code>.ui-panel</code><p className="muted">Frosted glass over the gradients.</p></div>
          </div>
        </div>
        <div className="ui-hero" style={{ marginTop: "var(--space-5)", padding: "var(--space-7) var(--space-5)" }}>
          <div className="ui-scene" aria-hidden="true"><div className="ui-scene__grid" /><div className="ui-scene__glow" /><div className="ui-scene__orb" /></div>
          <p className="ui-eyebrow">.ui-hero with .ui-scene (the glows drift slowly; still with reduced motion)</p>
          <h1 style={{ fontSize: "var(--text-3xl)" }}>Sample headline</h1>
        </div>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <caption>Contrast on the lighter tops of the depth surfaces.</caption>
            <thead><tr><th scope="col">Surface</th><th scope="col">text</th><th scope="col">muted</th><th scope="col">accent</th></tr></thead>
            <tbody>
              {Object.entries(DEPTH_SURFACES).map(([n, bg]) => (
                <tr key={n}><th scope="row">{n}</th>
                  {(["color-text", "color-text-muted", "color-accent"] as const).map((f) => <td key={f} className="num" style={{ background: bg, color: `var(--${f})` }}>{contrast(PALETTE[f], bg).toFixed(2)}:1</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="sg-texture" title="Texture, icons, tiles and art (D2b)" note="Depth from light and texture: near-solid fills, a thin gradient edge, faint noise, a cursor spotlight on desktop. No gloss, no bevels, no blob glows.">
        <p className="ui-row">{ICON_NAMES.map((n) => <span key={n} className="ui-tile__icon" title={n}><Icon name={n} /></span>)}</p>
        <div className="ui-grid">
          <article className="ui-tile"><p className="ui-label"><span className="ui-num">01</span> Label</p><h3>Sample tile</h3><p className="muted">Hover on a desktop to see the spotlight follow the cursor.</p></article>
          <div className="ui-tile" style={{ background: "var(--texture-grid), var(--color-surface)" }}><p className="ui-label">--texture-grid</p></div>
          <div className="ui-tile" style={{ background: "var(--texture-lines), var(--color-surface)" }}><p className="ui-label">--texture-lines</p></div>
          <ArtSlot src="/art/placeholder-lesson.svg" alt="Sample placeholder art" placeholder ratio="16 / 9" sizes="20rem" />
        </div>
        <h2 className="ui-display-2">Display <em>italic</em> emphasis</h2>
      </Section>

      <Section id="sg-learner" title="Learner patterns" note="Used by the public and learner screens (D2). Sample data only.">
        <div className="ui-stack">
          <p className="ui-ai-notice" role="note"><strong>AI notice:</strong> a sample disclosure, always shown in full with the accent edge.</p>
          <div className="ui-choices">
            <label className="ui-choice"><input type="radio" name="sg-plan" defaultChecked /> <span><b className="ui-choice__title">Sample plan A</b> <span className="ui-choice__price">$0.00</span> <span className="ui-choice__note">per month (sample)</span></span></label>
            <label className="ui-choice"><input type="radio" name="sg-plan" /> <span><b className="ui-choice__title">Sample plan B</b> <span className="ui-choice__price">$0.00</span> <span className="ui-choice__note">per month (sample)</span></span></label>
          </div>
          <div className="ui-legal"><p><b>Sample terms</b> <span className="muted">v0</span></p><p className="small">Legal and consent text keeps its own warm-edged box, at full size.</p></div>
          <label className="ui-consent"><input type="checkbox" /> <b>Consent.</b> A sample consent checkbox with its full sentence beside it.</label>
          <ol className="ui-steps"><li data-state="done">Sample step: done</li><li data-state="now">Sample step: in progress</li><li data-state="next">Sample step: next</li></ol>
          <p className="ui-meter-line small"><meter min={0} max={10} value={3} /> Sample allowance: used 3 of 10</p>
          <div className="ui-chat"><div className="ui-msg ui-msg--you"><p>Sample question.</p></div><div className="ui-msg ui-msg--mentor"><p>Sample answer.</p></div></div>
          <article className="ui-prose"><p>A sample paragraph with a citation marker<sup> <a href="#sg-learner">[1]</a></sup> and an uncited one <span className="ui-nosource">[No source]</span>.</p></article>
        </div>
      </Section>
    </div>
  );
}
