/**
 * Design rebuild D2: mounts the glass primitives with the root layout's page-wide pieces (the lens and the single
 * pointer listener), for e2e/components/design-primitives.spec.ts. window.__panels sets how many glass panels to render;
 * window.__unmount() unmounts everything (to check nothing is left behind).
 */
import { createRoot } from "react-dom/client";
import { GlassLens } from "../../../app/ui/glass-lens";
import { Spotlight } from "../../../app/ui/spotlight";
import { Glass } from "../../../app/ui/design/glass-panel";
import { Button } from "../../../app/ui/design/button";

const w = window as unknown as { __panels?: number; __unmount: () => void };
const n = w.__panels ?? 3;
const root = createRoot(document.getElementById("root")!);
root.render(
  <>
    <GlassLens />
    <Spotlight />
    <main className="ds-stagger" style={{ display: "grid", gap: 12, padding: 24, gridTemplateColumns: "repeat(4, 220px)" }}>
      <Glass hud data-testid="hud" style={{ padding: 16, height: 64 }}><Button variant="icon" icon="gear" label="Settings" /></Glass>
      {Array.from({ length: n }, (_, i) => (
        <Glass key={i} data-testid={`panel-${i}`} style={{ padding: 16, height: 120 }}>
          <p>Panel {i + 1}</p>
          <Button variant="primary">Continue</Button>
        </Glass>
      ))}
      <Glass as="button" type="button" tilt data-testid="tile" style={{ padding: 16, height: 120 }}>Tile</Glass>
      <div data-glass="frost" data-testid="frost-region"><Glass data-testid="frost-panel" style={{ padding: 16, height: 120 }}>Always frosted</Glass></div>
    </main>
  </>,
);
w.__unmount = () => root.unmount();
