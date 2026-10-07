import Link from "next/link";
import { preload } from "react-dom";
import { AccountPanel } from "./account-panel";
import { ServiceStatus } from "./service-status";
import { HeroMotion } from "./landing/hero-motion";
import { HeroScene } from "./landing/hero-scene";
import { EffectTiles } from "./landing/effect-tiles";
import { TiltCards } from "./landing/tilt-cards";
import { Frost } from "./ui/frost";
import { Crosshair } from "./ui/hud";
import { Icon, type IconName } from "./ui/icons";
import { ART, Picture, srcSet } from "./ui/picture";
import { SiteFooter } from "./ui/site-footer";
import { Reveal } from "./ui/reveal";
import { AmbientPause } from "./ui/ambient-pause";

// D2b: every line here describes how ASCENTRA already works (the screens and notices it links to say the same).
const FEATURES: { n: string; label: string; icon: IconName; title: string; body: string; size: "wide" | "tall" | "small"; art?: "left" | "right"; tilt?: boolean }[] = [
  { n: "01", label: "Lessons", icon: "cite", title: "Cited, line by line", size: "wide",
    body: "Each lesson is written from approved sources and cites them inline. A passage without a source is marked, and every lesson shows when it was last verified.",
    art: "left" },
  { n: "02", label: "Mentor", icon: "mentor", title: "An AI Mentor that shows its sources", size: "tall",
    body: "The Mentor (Claude, an AI) answers from the course's approved sources, cites them, and says when they don't cover a question. It won't do graded work.",
    art: "right" },
  { n: "03", tilt: true, label: "Your path", icon: "path", title: "A path from four questions", size: "small",
    body: "Goal, level, time and topics. Your path is picked from published courses; nothing is generated just for you." },
  { n: "04", tilt: true, label: "Practice", icon: "practice", title: "Honest about grading", size: "small",
    body: "Graded checks show the answer with a cited explanation. Everything else is labeled practice, not graded." },
  { n: "05", tilt: true, label: "Privacy", icon: "privacy", title: "Your data, your call", size: "small",
    body: "Download your data or request deletion in the Privacy Center. Mentor conversations aren't used to train AI models." },
  { n: "06", label: "Families", icon: "family", title: "Teens join with a Guardian", size: "wide",
    body: "Learners 14 to 17 need a parent or guardian, who confirms they're an adult and agrees to the teen terms before anything starts." },
];
const STEPS = [
  { title: "Create your account", body: "Sign up, then confirm your date of birth." },
  { title: "Choose a plan", body: "Basic or Pro. Basic can start with a free trial." },
  { title: "Answer four quick questions", body: "Or skip them; you can take them any time from My path." },
  { title: "Read, practice, ask", body: "Lessons with their sources, practice items, and the Mentor beside each lesson (it needs a Mentor allowance)." },
];

const HERO_SIZES = "(min-width: 64rem) 40rem, 86vw";

export default function Home() {
  // The hero sculpture is the largest image on this page: fetch it early, at the size this screen needs.
  preload(`${ART.heroSculpture.base}-960.avif`, { as: "image", fetchPriority: "high", imageSrcSet: srcSet(ART.heroSculpture, "avif"), imageSizes: HERO_SIZES });
  return (
    <main className="landing">
      <Reveal />
      <AmbientPause />
      <header className="hero" data-ambient>
        <div className="hero__bg" aria-hidden="true">
          <Picture art={ART.textureTopo} sizes="100vw" className="hero__texture" priority />
          <div className="hero__dust" />
        </div>
        <Crosshair className="hud-cross--tl" />
        <Crosshair className="hud-cross--br" />
        <div className="hero__inner">
          <p className="ui-label">ASCENTRA</p>
          <h1 className="hero__title">ASCENTRA · <em>Foundations</em> in progress</h1>
          <p className="hero__lede">Courses written from reviewed sources. Each lesson cites them, marks anything without one, and shows when it was last verified.</p>
          <div className="hero__account"><AccountPanel /></div>
        </div>
        <div className="hero__art" aria-hidden="true">
          <Picture art={ART.heroSculpture} sizes={HERO_SIZES} className="hero__sculpture" priority />
          <HeroScene />
        </div>
        <HeroMotion />
      </header>
      <EffectTiles />
      <TiltCards />

      <section className="landing__section hud-ruler" aria-labelledby="features-h">
        <div className="landing__head" data-reveal>
          <p className="ui-label">What&apos;s inside</p>
          <h2 id="features-h" className="ui-display-2">Learning you can <em>check</em>.</h2>
        </div>
        <div className="bento">
          {FEATURES.map((f, i) => (
            <article key={f.n} className={`ui-tile hud-frame has-frost bento__${f.size}`} data-reveal data-tilt={f.tilt ? "" : undefined} style={{ ["--i" as string]: i % 3 }}>
              <Frost />
              {f.tilt && <span className="tilt-glare" aria-hidden="true" />}
              <p className="ui-label ui-tile__label"><span className="ui-num">{f.n}</span> / {f.label}</p>
              <span className="ui-tile__icon"><Icon name={f.icon} /></span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
              {f.art && <div className={`tile-art tile-art--${f.art}`} aria-hidden="true"><Picture art={ART.cardGlass} sizes={f.size === "tall" ? "(min-width: 60rem) 24rem, 90vw" : "(min-width: 60rem) 48rem, 90vw"} /></div>}
            </article>
          ))}
        </div>
      </section>

      <section className="landing__section how hud-ruler" aria-labelledby="how-h">
        <div className="how__aside">
          <div className="how__sticky">
            <p className="ui-label">How it works</p>
            <h2 id="how-h" className="ui-display-2">From sign-up to your <em>first lesson</em>.</h2>
          </div>
        </div>
        <ol className="how__steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="ui-tile hud-frame" data-reveal style={{ ["--i" as string]: 0 }}>
              <span className="how__n ui-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing__section landing__status" aria-label="Service status" data-reveal>
        <div className="ui-block home-status"><ServiceStatus /></div>
      </section>

      <section className="closing" aria-labelledby="closing-h" data-reveal data-ambient>
        <span className="closing__glow" aria-hidden="true" />
        <Crosshair className="hud-cross--tl" />
        <Crosshair className="hud-cross--tr" />
        <h2 id="closing-h" className="closing__title">Start where you <em>are</em>.</h2>
        <p className="ui-actions closing__actions">
          <Link href="/sign-up" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--breathe">Create an account <Icon name="arrow" size={18} /></Link>
        </p>
        <p className="ui-label closing__foot">ASCENTRA is available in the United States.</p>
      </section>
      <SiteFooter />
    </main>
  );
}
