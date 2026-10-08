"use client";

import { NeoButton, NeoCard, NeoChart, NeoInput, NeoProgress, NeoRing, NeoToggle, NeoVideo, NeoWell } from "../../ui/neo";

export function CourseUiShowcase() {
  return (
    <div className="neo-showcase">
      <NeoCard as="section">
        <h2>Example: course progress</h2>
        <p className="muted">Example only. 6 of 10 lessons done.</p>
        <NeoProgress value={6} max={10} label="Example course progress" />
        <div className="neo-showcase__row"><NeoRing value={60} label="Example course progress" /><NeoRing value={25} label="Example practice rounds" size={72} /></div>
      </NeoCard>
      <NeoCard as="section">
        <h2>Example: practice this week</h2>
        <NeoChart title="Example: practice minutes per day" points={[12, 18, 9, 24, 20, 30, 26]} labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} />
      </NeoCard>
      <NeoCard as="section">
        <h2>Example: lesson video</h2>
        <NeoVideo title="Example lesson video" />
      </NeoCard>
      <NeoCard as="section">
        <h2>Example: inputs</h2>
        <NeoWell><NeoInput label="Example: your note" placeholder="Type a note" /></NeoWell>
        <div className="neo-showcase__row"><NeoToggle label="Example setting" /><NeoButton>Example button</NeoButton></div>
      </NeoCard>
    </div>
  );
}
