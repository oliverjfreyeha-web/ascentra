"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { call } from "../../call";
import { chooserFrom, type ChoiceTopic, type Chooser, type PathAnswers } from "../../picks-api";
import { Glass } from "../../ui/glass";
import { Icon } from "../../ui/icons";
import { Loading } from "../../ui/loading";
import "./choose.css";

/**
 * L8: "Choose your path" in three steps: five short questions, a business (the 5 best matches first, then "See all"),
 * and skills up to the plan's limit with a plain counter. Every limit is checked on the server; this page only shows
 * the answer. Nothing here promises income.
 * R1: during sign-up (?onboarding=1) this is step 3 of 4; "Continue" goes back to /welcome, where the server says
 * what comes next (the plan, for an adult; the learner home, for a teen).
 */
const STEPS = ["Your answers", "Your business", "Your skills"] as const;

export function ChoosePage() {
  const onboarding = useSearchParams().get("onboarding") === "1";
  const router = useRouter();
  const [data, setData] = useState<Chooser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/learn/picks");
    const c = r._status === 200 ? chooserFrom(r) : null;
    setData(c);
    if (!c) setMessage(r.reason ?? "Couldn't load the topics.");
    return c;
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load().then((c) => { if (c?.answers) setStep(1); });
  }, [load]);
  useEffect(() => {
    // Moving between steps puts keyboard and screen-reader focus on the new step's heading.
    if (first.current) { first.current = false; return; }
    head.current?.focus();
  }, [step]);

  async function send(method: string, url: string, body: unknown, done?: string) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const c = r._status < 300 ? chooserFrom(r) : null;
    if (c) setData(c);
    setMessage(c ? done ?? null : r.reason ?? "Nothing was changed.");
    return !!c;
  }

  if (!data) return message ? <p className="muted ui-state ui-state--error">{message}</p> : <Loading shape="list" />;
  return (
    <div className="choose">
      <p className="choose__note" role="note">{data.note}</p>
      <ol className="choose__steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" className="choose__step ui-plain" aria-current={step === i ? "step" : undefined}
              disabled={i > 0 && !data.answers} onClick={() => setStep(i)}>
              <span className="choose__num" aria-hidden="true">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>
      <p className="small muted">{data.planNote}{!data.plan && !onboarding && <> <Link href="/account">Plans and the free trial</Link></>}</p>
      {message && <p role="status" className="choose__status">{message}</p>}
      <Glass as="section" className="choose__panel" aria-labelledby="choose-step">
        <h2 id="choose-step" ref={head} tabIndex={-1}>{step + 1}. {STEPS[step]}</h2>
        {step === 0 && <Questions data={data} busy={busy} onSave={async (a) => { if (await send("PUT", "/api/v1/learn/picks/answers", a, "Saved. Here are your best matches.")) setStep(1); }} />}
        {step === 1 && <Businesses data={data} busy={busy} onPick={(t) => void send("POST", "/api/v1/learn/picks", { slug: t.slug }, `Picked: ${t.name}.`)} onNext={() => setStep(2)} />}
        {step === 2 && <Skills data={data} busy={busy} onboarding={onboarding} onContinue={() => router.push("/welcome")}
          onPick={(t) => void send("POST", "/api/v1/learn/picks", { slug: t.slug }, `Picked: ${t.name}.`)}
          onPause={(t) => void send("POST", "/api/v1/learn/picks/pause", { slug: t.slug }, `Set aside: ${t.name}. It's kept; you can pick it again.`)} />}
      </Glass>
    </div>
  );
}

function Questions({ data, busy, onSave }: { data: Chooser; busy: boolean; onSave: (a: PathAnswers) => void }) {
  const [a, setA] = useState<Partial<PathAnswers>>(data.answers ?? {});
  const keys = ["goal", "hours", "experience", "style", "camera"] as const;
  const done = keys.every((k) => a[k] !== undefined);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (done) onSave(a as PathAnswers);
  }
  return (
    <form onSubmit={submit} aria-label="Five questions" className="ui-form">
      <p className="small muted">Five quick questions, each from a list. Your answers are private to you and in your Privacy Center download.</p>
      {keys.map((k, n) => (
        <fieldset key={k}>
          <legend>{n + 1}. {data.questions[k].label}</legend>
          <div className="ui-pills">
            {Object.entries(data.questions[k].options).map(([v, label]) => {
              const value = k === "hours" ? Number(v) : v;
              return (
                <label key={v} className="ui-pill">
                  <input type="radio" name={k} checked={a[k] === value} onChange={() => setA({ ...a, [k]: value })} /> {label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="ui-actions"><button type="submit" className="primary" disabled={busy || !done}>{data.answers ? "Save my answers" : "See my matches"}</button></p>
    </form>
  );
}

function Badges({ t }: { t: ChoiceTopic }) {
  return (
    <span className="choose__badges">
      {!t.hasCourse && <span className="ui-badge">Course coming</span>}
      {t.paused && <span className="ui-badge">Set aside</span>}
    </span>
  );
}

function Businesses({ data, busy, onPick, onNext }: { data: Chooser; busy: boolean; onPick: (t: ChoiceTopic) => void; onNext: () => void }) {
  const [all, setAll] = useState(false);
  const best = data.businesses.filter((b) => b.best);
  const list = all || !best.length ? data.businesses : best;
  const current = data.business;
  return (
    <>
      {current && (
        <p className="choose__current">
          Your business: <strong>{current.name}</strong>
          {current.locked && <span className="choose__lock"><Icon name="lock" size={16} /> {current.lockNote}</span>}
        </p>
      )}
      <p className="small muted">{best.length && !all ? "Your 5 best matches, from your answers." : "Every business, all online and remote."}</p>
      <ul className="choose__grid" aria-label={all || !best.length ? "All businesses" : "Best matches"}>
        {list.map((t) => {
          const lockedOther = !!current?.locked && !t.picked;
          return (
            <li key={t.slug} className="choose__card" data-picked={t.picked || undefined}>
              <h3>{t.name}</h3>
              <p className="small">{t.blurb}</p>
              {t.why.length > 0 && <p className="small muted">Why: {t.why.join(" ")}</p>}
              <Badges t={t} />
              {t.picked ? (
                <p className="choose__picked">{t.locked ? <><Icon name="lock" size={16} /> Your business. {current?.lockNote}</> : "Your business"}</p>
              ) : (
                <button type="button" disabled={busy || lockedOther} onClick={() => onPick(t)}
                  aria-describedby={lockedOther ? "choose-lock-note" : undefined}>
                  {current && !current.locked ? `Switch to ${t.name}` : `Pick ${t.name}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {current?.locked && <p id="choose-lock-note" className="small muted"><Icon name="lock" size={16} /> {current.lockNote}</p>}
      <p className="ui-actions">
        {best.length > 0 && <button type="button" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show best matches" : `See all ${data.businesses.length}`}</button>}
        <button type="button" className="primary" onClick={onNext}>Next: skills</button>
      </p>
    </>
  );
}

function Skills({ data, busy, onPick, onPause, onboarding, onContinue }: {
  data: Chooser; busy: boolean; onPick: (t: ChoiceTopic) => void; onPause: (t: ChoiceTopic) => void; onboarding: boolean; onContinue: () => void;
}) {
  const full = data.skillLimit !== null && data.skillsUsed >= data.skillLimit;
  return (
    <>
      <p className="choose__counter" aria-live="polite"><strong>{data.skillCounter}</strong></p>
      {full && <p className="small muted">To pick another, set one aside first. It&apos;s kept, and you can pick it again later.</p>}
      <ul className="choose__grid" aria-label="Skills">
        {data.skills.map((t) => (
          <li key={t.slug} className="choose__card" data-picked={t.picked || undefined}>
            <h3>{t.name}</h3>
            <p className="small">{t.blurb}</p>
            <Badges t={t} />
            {t.picked
              ? <button type="button" disabled={busy} onClick={() => onPause(t)}>Set aside {t.name}</button>
              : <button type="button" disabled={busy || full} onClick={() => onPick(t)}>Pick {t.name}</button>}
          </li>
        ))}
      </ul>
      {onboarding ? (
        <p className="ui-actions">
          <button type="button" className="primary" disabled={busy || !data.business} onClick={onContinue} aria-describedby={data.business ? undefined : "choose-need-business"}>Continue</button>
          {!data.business && <span id="choose-need-business" className="small muted">Pick a business first (step 2). Skills are optional.</span>}
        </p>
      ) : <p className="small"><Link href="/learn">Back to Learn</Link></p>}
    </>
  );
}
