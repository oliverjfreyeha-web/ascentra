"use client";

import { useState } from "react";
import { CountUp } from "../../ui/count-up";
import { Button } from "../../ui/design/button";
import { Glass } from "../../ui/design/glass-panel";
import { Icon } from "../../ui/design/ds-icon";
import { Segmented } from "../../ui/design/segmented";

/** Design rebuild D2 · Every primitive, once per glass type, over a busy backdrop so the blur and the lens show. */
export function PrimitivesSection({ theme }: { theme: string }) {
  return (
    <section aria-label={`${theme} primitives`} className="dp-prims">
      <h3 className="ds-caps">Primitives · Frosted and Liquid</h3>
      <div className="dp-prims__pair">
        <GlassSet glass="frost" title="Frosted" />
        <GlassSet glass="liquid" title="Liquid" />
      </div>
      <MotionSet />
    </section>
  );
}

function GlassSet({ glass, title }: { glass: "frost" | "liquid"; title: string }) {
  const [seg, setSeg] = useState<"week" | "month" | "year">("week");
  return (
    <div className="dp-stage" data-glass={glass}>
      <div className="dp-stage__backdrop" aria-hidden="true"><i /><i /><i /><i /></div>
      <p className="ds-caps dp-stage__label">{title}</p>
      <Glass hud className="dp-hud" data-testid={`hud-${glass}`}>
        <span className="ds-display dp-hud__brand">Ascentra</span>
        <Button variant="icon" icon="gear" label="Appearance settings" size="sm" />
        <Button variant="icon" icon="user" label="Account" size="sm" />
      </Glass>
      <Glass className="dp-panel" data-testid={`panel-${glass}`}>
        <p className="ds-caps">Up next</p>
        <p className="dp-panel__title">Section 2 · Cold email</p>
        <div className="dp-row">
          <Button variant="primary" icon="book">Continue</Button>
          <Button>Later</Button>
        </div>
        <Segmented label="Activity range" value={seg} onChange={setSeg} options={[["week", "Week"], ["month", "Month"], ["year", "Year"]]} />
      </Glass>
      <div className="dp-row">
        <Glass as="button" type="button" tilt className="dp-tilecard" data-sfx="nav">
          <Icon name="mail" size={22} />
          <span>Section card</span>
          <small>Tilts toward the pointer</small>
        </Glass>
        <Glass widget className="dp-tilecard">
          <Icon name="flame" size={22} />
          <span>Widget</span>
          <small>Never tilts</small>
        </Glass>
      </div>
    </div>
  );
}

function MotionSet() {
  const [run, setRun] = useState(0);
  return (
    <div className="dp-motion">
      <div className="dp-row">
        <Button size="sm" icon="refresh" onClick={() => setRun((n) => n + 1)}>Replay entrance</Button>
        <span className="dp-note">Rise 26px, scale .965 to 1, staggered 60ms · off when Reduced</span>
      </div>
      <div key={run} className="ds-stagger dp-stagger">
        {["Basics", "Cold email", "Messages", "Warming up", "Tracking"].map((t, i) => (
          <Glass as="div" key={t} className="dp-mini"><span className="ds-num">{i + 1}</span><span>{t}</span></Glass>
        ))}
      </div>
      <div className="dp-row">
        <svg key={`p${run}`} className="dp-spark" viewBox="0 0 120 40" aria-label="Draw-in path example" role="img">
          <path className="ds-draw" pathLength={1} d="M0 34 L17 30 L34 31 L51 22 L68 18 L85 19 L102 9 L120 4" />
        </svg>
        <p className="dp-count"><span className="ds-num"><CountUp key={`c${run}`} value={1240} /></span><small>CountUp (the app&apos;s own)</small></p>
      </div>
    </div>
  );
}
