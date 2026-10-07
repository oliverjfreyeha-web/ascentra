import type { Metadata } from "next";
import Link from "next/link";
import { TRACKS } from "../ui/sound/tracks";

export const metadata: Metadata = { title: "Art and sound credits · ASCENTRA" };

/** D2c/D2e: where the site's art and music come from. Kept in step with docs/design/ASSETS.md and app/ui/sound/tracks.ts. */
export default function CreditsPage() {
  return (
    <main>
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link></nav>
      <header className="ui-page-head">
        <h1>Art and sound credits</h1>
      </header>
      <div className="ui-block">
        <p>
          The hero art (a glass sculpture), the background textures, the card art and the optional ambient music on ASCENTRA
          were made with AI, using DaVinci AI, and are used under that service&apos;s terms.
        </p>
        <ul>
          <li>Hero art, glass sculpture: made with DaVinci AI</li>
          <li>Topographic line texture: made with DaVinci AI</li>
          <li>Glass panels card art (recolored to our palette): made with DaVinci AI</li>
          <li>Frost texture and the 3D hero scene: made in code for ASCENTRA, without AI (3D drawn with three.js, MIT License)</li>
        </ul>
        <h2>Ambient soundtracks</h2>
        <p className="muted">Off unless you turn them on.</p>
        <ul>
          {TRACKS.map((t) => (
            <li key={t.id}>{t.title} ({t.mood.toLowerCase()}): {t.aiLabel}, source tool {t.tool}.</li>
          ))}
        </ul>
        <p className="muted">Icons and interface patterns are drawn for ASCENTRA. Fonts: Geist, Geist Mono and Instrument Serif, under the SIL Open Font License.</p>
      </div>
    </main>
  );
}
