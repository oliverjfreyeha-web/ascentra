import Link from "next/link";
import { preload } from "react-dom";
import { PLANS, TRIAL_DAYS } from "@/lib/billing-terms";
import { Glass } from "../../ui/glass";
import { SCENE_INFO } from "../../env/prefs";
import { AuthSwitch, WorldDock } from "./world-controls";
import "./world.css";

const WORLD_SCENES = ["reef", "lake", "mist", "sun"] as const;
// Signed in? Clerk's __client_uat cookie is non-zero. Read before first paint so the hero never flashes for members.
const AUTH_BOOT = `(function(){try{if(/(?:^|; )__client_uat=[1-9]/.test(document.cookie)){var r=document.querySelector("[data-landing]");if(r)r.setAttribute("data-auth","in")}}catch(e){}})()`;

/**
 * D5 · The landing hero: the live wallpaper behind (app/env), a glass nav, the headline, the trial card, and the scene
 * and glass switchers. Every price and rule on it comes from lib/billing-terms (Basic $20, Pro $50, a 14-day trial
 * that continues as Basic). The buttons go to the existing sign-up and sign-in pages; nothing here starts a trial.
 */
export function WorldHero() {
  // The default scene's photo, fetched early at the size this window needs (Alpine lake unless a visitor chose another).
  preload("/env/lake-1920.webp", { as: "image", fetchPriority: "high", media: "(min-width: 900px)" });
  preload("/env/lake-1080.webp", { as: "image", fetchPriority: "high", media: "(max-width: 899.98px)" });
  const basic = PLANS.basic, pro = PLANS.pro;
  return (
    <section className="world" aria-labelledby="world-h">
      <div hidden dangerouslySetInnerHTML={{ __html: `<script>${AUTH_BOOT}</script>` }} />
      <AuthSwitch />
      <div className="world__ui" id="world-ui">
        <Glass as="header" className="world__nav">
          <Link href="/" className="world__mark">ASCENTRA</Link>
          <nav className="world__links" aria-label="Primary">
            <a href="#features-h">Courses</a>
            <a href="#plans">Plans</a>
            <a href="#guardians">For guardians</a>
          </nav>
          <Link href="/sign-in" className="world__btn world__btn--ghost">Sign in</Link>
        </Glass>

        <div className="world__hero">
          <div className="world__copy">
            <h1 id="world-h" className="world__title">
              Learn inside a{" "}
              <em>{WORLD_SCENES.map((s) => <span key={s} data-for={s}>{SCENE_INFO[s].word}</span>)}</em>{" "}
              world.
            </h1>
            <p className="world__lede">Short lessons, real practice rounds, and a clear path from your first skill to your first business. Built for young founders.</p>
          </div>
          <Glass as="aside" className="world__trial" id="plans" aria-labelledby="trial-h">
            <h2 id="trial-h">Start your {TRIAL_DAYS}-day free trial</h2>
            <p>Try the full {basic.name} experience for {TRIAL_DAYS} days. After the trial your plan continues as {basic.name}.</p>
            <div className="world__plans">
              <div className="world__plan"><span>{basic.name}</span><strong>${basic.cents / 100}</strong> <small>/ month</small></div>
              <div className="world__plan"><span>{pro.name}</span><strong>${pro.cents / 100}</strong> <small>/ month</small></div>
            </div>
            <Link href="/sign-up" className="world__btn">Start {TRIAL_DAYS}-day trial</Link>
            <p className="world__fine">United States only. Ages 14 and up. Ages 14 to 17 need a verified guardian.</p>
          </Glass>
        </div>
        <WorldDock />
      </div>
    </section>
  );
}
