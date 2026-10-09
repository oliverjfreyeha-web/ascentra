import Link from "next/link";
import { preload } from "react-dom";
import { PLANS, TRIAL_DAYS } from "@/lib/billing-terms";
import { Glass } from "../../ui/glass";
import { HallLife } from "./hall-life";
import { bootScript, phaseQueryAllowed, PHOTO, seeded, WINDOWS, windowTimings } from "./cycle";
import "./hall.css";

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const HALL = { base: "/art/hall", widths: [640, 1344] } as const;
const srcSet = (ext: "avif" | "webp") => HALL.widths.map((w) => `${HALL.base}-${w}.${ext} ${w}w`).join(", ");
/** The stage covers the hero: as wide as the screen, or 1.9 × its height on tall screens (phones), whichever is larger. */
const SIZES = "(max-aspect-ratio: 19/10) 190vh, 100vw";

/** Stars: three sets of tiny dots, each set one element that twinkles as a whole (3 animations, not 90). */
function starSets(): string[] {
  const r = seeded(11);
  return [0, 1, 2].map(() =>
    Array.from({ length: 30 }, () => {
      const x = (r() * 100).toFixed(2), y = (r() * 70).toFixed(2), s = (0.6 + r() * 1.1).toFixed(2), o = (0.35 + r() * 0.6).toFixed(2);
      return `radial-gradient(${s}px ${s}px at ${x}% ${y}%, rgb(232 241 255 / ${o}) 50%, transparent 100%)`;
    }).join(","),
  );
}

/**
 * D4 · The Hall: the landing's first screen for visitors who are not signed in. A photograph-like hall at dusk (an
 * AI-generated image; nothing on the page claims it is a real place), with a replacement sky masked behind the building,
 * stars, clouds, mist, lit windows, foliage in front of the lights, and fireflies. The sky follows the visitor's clock.
 * Everything visual is decorative (aria-hidden, pointer-events: none); the words and links are ordinary HTML.
 */
/** `preloadImage` (D5): off when the Hall is not the visitor's chosen scene, so its picture is not fetched early. */
export function Hall({ preloadImage = true }: { preloadImage?: boolean } = {}) {
  const allowQuery = phaseQueryAllowed(process.env.NODE_ENV, process.env.VERCEL_ENV);
  if (preloadImage) preload(`${HALL.base}-1344.avif`, { as: "image", fetchPriority: "high", imageSrcSet: srcSet("avif"), imageSizes: SIZES, type: "image/avif" });
  const timings = windowTimings();
  const stars = starSets();
  const basic = PLANS.basic;
  return (
    <section className="hall" id="hall" aria-labelledby="hall-h" data-ambient suppressHydrationWarning>
      {/* Raw markup, so the browser runs it while parsing (before first paint) and React never renders a <script>. */}
      <div hidden dangerouslySetInnerHTML={{ __html: `<script>${bootScript(allowQuery)}</script>` }} />
      <div className="hall__scene" aria-hidden="true">
        <div className="hall__stage">
          <picture className="hall__photo">
            <source type="image/avif" srcSet={srcSet("avif")} sizes={SIZES} />
            <source type="image/webp" srcSet={srcSet("webp")} sizes={SIZES} />
            <img src={`${HALL.base}-1344.webp`} alt="" width={PHOTO.width} height={PHOTO.height} decoding="async" fetchPriority="high" />
          </picture>
          <div className="hall__sky">
            <div className="hall__sky-fill" />
            <div className="hall__stars">{stars.map((bg, i) => <i key={i} style={{ backgroundImage: bg }} />)}</div>
            <div className="hall__cloud hall__cloud--1" />
            <div className="hall__cloud hall__cloud--2" />
            <div className="hall__cloud hall__cloud--3" />
          </div>
          <div className="hall__tint" />
          <div className="hall__rim" />
          <div className="hall__wins">
            {WINDOWS.map(([x, y, w, h], i) => (
              <i key={i} className="hall__win" style={{ left: pct(x, PHOTO.width), top: pct(y, PHOTO.height), width: pct(w, PHOTO.width), height: pct(h, PHOTO.height), ["--d" as string]: `${timings[i].d}s`, ["--b" as string]: timings[i].b }} />
            ))}
            <i className="hall__door" />
            <i className="hall__spill" />
          </div>
          <picture className="hall__foliage">
            <source type="image/avif" srcSet="/art/hall-foliage.avif" />
            <img src="/art/hall-foliage.webp" alt="" width={1344} height={267} decoding="async" />
          </picture>
        </div>
        <div className="hall__mist hall__mist--1" />
        <div className="hall__mist hall__mist--2" />
        <div className="hall__wash" />
        <div className="hall__grain" />
        <canvas className="hall__fireflies" />
        <div className="hall__scrim" />
      </div>

      <Glass as="nav" className="hall__nav" aria-label="Main">
        <Link href="/" className="hall__mark">ASCENTRA</Link>
        <a href="#how-h" className="hall__navlink hall__navlink--wide">How it works</a>
        <Link href="/sign-in" className="hall__navlink">Sign in</Link>
        <Link href="/sign-up" className="hall__go">Start trial</Link>
      </Glass>

      <div className="hall__copy">
        <h1 id="hall-h" className="hall__title">
          <span>ASCENTRA</span> <em>Founders</em> <span>Academy</span>
        </h1>
        <p className="hall__lede">Learn real skills and start building a real business.</p>
        <p className="hall__cta">
          <Link href="/sign-up" className="hall__btn hall__btn--primary">Start your {TRIAL_DAYS}-day trial</Link>
          <a href="#how-h" className="hall__btn hall__btn--glass ui-glass">See how it works</a>
        </p>
      </div>

      <Glass as="aside" className="hall__note" aria-label="Plan and eligibility">
        <p><b>{TRIAL_DAYS}-day trial</b>, then {basic.name} at ${basic.cents / 100}/month. US only, ages 14 and up; a verified Guardian is required under 18.</p>
      </Glass>
      <HallLife allowQuery={allowQuery} />
    </section>
  );
}
