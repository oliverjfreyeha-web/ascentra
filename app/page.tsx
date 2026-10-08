import Link from "next/link";
import { AccountPanel } from "./account-panel";
import { ServiceStatus } from "./service-status";
import { Hall } from "./landing/hall/hall";
import { WorldHero } from "./landing/world/world-hero";
import { HallSlot } from "./landing/world/world-controls";
import { Icon, type IconName } from "./ui/icons";
import { ART, Picture } from "./ui/picture";
import { SiteFooter } from "./ui/site-footer";
import { Reveal } from "./ui/reveal";
import { AmbientPause } from "./ui/ambient-pause";

// D2b: every line here describes how ASCENTRA already works (the screens and notices it links to say the same).
const FEATURES: { n: string; label: string; icon: IconName; title: string; body: string; size: "wide" | "tall" | "small"; art?: "left" | "right" }[] = [
  { n: "01", label: "Lessons", icon: "cite", title: "Cited, line by line", size: "wide",
    body: "Each lesson is written from approved sources and cites them inline. A passage without a source is marked, and every lesson shows when it was last verified.",
    art: "left" },
  { n: "02", label: "Mentor", icon: "mentor", title: "An AI Mentor that shows its sources", size: "tall",
    body: "The Mentor (Claude, an AI) answers from the course's approved sources, cites them, and says when they don't cover a question. It won't do graded work.",
    art: "right" },
  { n: "03", label: "Your path", icon: "path", title: "A path from four questions", size: "small",
    body: "Goal, level, time and topics. Your path is picked from published courses; nothing is generated just for you." },
  { n: "04", label: "Practice", icon: "practice", title: "Honest about grading", size: "small",
    body: "Graded checks show the answer with a cited explanation. Everything else is labeled practice, not graded." },
  { n: "05", label: "Privacy", icon: "privacy", title: "Your data, your call", size: "small",
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

export default function Home() {
  // D5: visitors who are not signed in see the living-world hero (or the Hall, if they chose it as their scene);
  // signed-in visitors see Home (the account line and its links). Chosen before first paint, then confirmed by Clerk.
  return (
    <main className="landing" data-landing suppressHydrationWarning>
      <Reveal />
      <AmbientPause />
      <WorldHero />
      <HallSlot><Hall preloadImage={false} /></HallSlot>
      <div className="landing__rest">
      <header className="home-head">
        <div className="home-head__inner">
          <h1 className="home-head__title">ASCENTRA <em>Founders</em> Academy</h1>
          <div className="home-head__account"><AccountPanel /></div>
        </div>
      </header>

      <section className="landing__section" aria-labelledby="features-h">
        <div className="landing__head" data-reveal>
          <h2 id="features-h" className="ui-display-2">Learning you can <em>check</em>.</h2>
        </div>
        <div className="bento">
          {FEATURES.map((f, i) => (
            <article key={f.n} id={f.label === "Families" ? "guardians" : undefined} className={`ui-tile bento__${f.size}`} data-reveal style={{ ["--i" as string]: i % 3 }}>
              <span className="ui-tile__icon"><Icon name={f.icon} /></span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
              {f.art && <div className={`tile-art tile-art--${f.art}`} aria-hidden="true"><Picture art={ART.cardGlass} sizes={f.size === "tall" ? "(min-width: 60rem) 24rem, 90vw" : "(min-width: 60rem) 48rem, 90vw"} /></div>}
            </article>
          ))}
        </div>
      </section>

      <section className="landing__section how" aria-labelledby="how-h">
        <div className="how__aside">
          <div className="how__sticky">
            <h2 id="how-h" className="ui-display-2">From sign-up to your <em>first lesson</em>.</h2>
          </div>
        </div>
        <ol className="how__steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="ui-tile" data-reveal style={{ ["--i" as string]: 0 }}>
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
        <h2 id="closing-h" className="closing__title">Start where you <em>are</em>.</h2>
        <p className="ui-actions closing__actions">
          <Link href="/sign-up" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--breathe">Create an account <Icon name="arrow" size={18} /></Link>
        </p>
        <p className="ui-label closing__foot">ASCENTRA is available in the United States.</p>
      </section>
      <SiteFooter />
      </div>
    </main>
  );
}
