"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { call } from "../call";
import { US_STATES } from "@/lib/progress/config";
import { SignOut } from "../sign-out";
import { BillingPanel } from "../account/billing-panel";
import { loadFailure } from "./load-failure";

type Progress = "none" | "invited" | "joined" | "verified" | "agreed" | "failed";
type State =
  | { state: "dob" }
  | { state: "guardian"; guardianEmail: string | null; progress: Progress; emailSent: boolean }
  | { state: "guardian_signup"; teenName: string }
  | { state: "paused"; since: string | null }
  | { state: "second_factor" }
  | { state: "interview"; next: string }
  | { state: "plan" }
  | { state: "ready"; home: string }
  | { state: "not_open"; reason: string };

/** Shown when Continue is pressed without confirming US residence (the server's own check says the same). */
export const US_CONFIRM = "Confirm that you live in the United States to continue.";
/** The existing US-only message (lib/registration.ts US_ONLY says the same to anyone who sends it anyway). */
export const US_ONLY_TEXT = "ASCENTRA is available in the United States only, so we can't create an account for you. Nothing you entered was saved.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (s: string, n: number) => s.trim().padStart(n, "0");

/**
 * The step after Clerk sign-up (B2), and where a signed-in person without access lands. The server decides
 * everything: this page only shows the state /api/registration returns.
 */
export function WelcomeFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const [s, setS] = useState<State | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/registration");
    if (r._status === 200) setS(r as unknown as State);
    else setFailed(loadFailure(r._status));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the server's state once signed in
    if (isSignedIn) void load();
  }, [isSignedIn, load]);

  useEffect(() => {
    if (s?.state === "ready") router.replace(s.home);
    // R1: step 3 is "Choose your path"; it sends them back here when it's done.
    if (s?.state === "interview") router.replace(s.next);
  }, [s, router]);

  // R1: back from Stripe Checkout during sign-up. Stripe confirms by webhook a moment later: look again a few times.
  useEffect(() => {
    if (!isSignedIn || new URLSearchParams(window.location.search).get("billing") !== "success") return;
    const t = [3000, 8000, 15000, 30000].map((ms) => setTimeout(() => void load(), ms));
    return () => t.forEach(clearTimeout);
  }, [isSignedIn, load]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <p>
        <Link href="/sign-in">Sign in</Link> or <Link href="/sign-up">create an account</Link>.
      </p>
    );
  }
  if (failed) return <section><p role="alert">{failed}</p><p><SignOut /></p></section>;
  if (!s || s.state === "ready" || s.state === "interview") return <p className="muted">Checking your account…</p>;
  if (s.state === "plan") return <PlanStep />;
  if (s.state === "dob") return <DobStep onDone={setS} onRefused={() => void signOut({ redirectUrl: "/not-available" }).catch(() => router.replace("/not-available"))} />;
  if (s.state === "guardian") return <GuardianStep s={s} onDone={setS} />;
  if (s.state === "guardian_signup") return <GuardianSignup teenName={s.teenName} onDone={setS} />;
  if (s.state === "paused") {
    return (
      <section>
        <h1>Your account is paused</h1>
        <p>
          Your Guardian withdrew their consent{s.since ? ` on ${new Date(s.since).toLocaleDateString()}` : ""}. Your account
          is paused, not deleted: your progress is kept. Learning, billing and messages are off until your Guardian gives
          consent again.
        </p>
        <p><SignOut /></p>
      </section>
    );
  }
  if (s.state === "second_factor") {
    // R1: only the Owner, administrators and Guardians get here. A learner's second factor is optional.
    return (
      <section>
        <h1>Your role needs a second factor</h1>
        <p>
          Owner, administrator and Guardian accounts must have a second factor before anything works, because they manage
          other people&apos;s access, consent or payments. Add an authenticator app: open{" "}
          <Link href="/account#sign-in-methods">Account → Sign-in methods</Link>, choose <b>Security</b>, then add an
          authenticator app. Then come back here. It can take a few seconds to register.
        </p>
        <p>
          <Link href="/account#sign-in-methods" className="ui-btn ui-btn--primary">Add a second factor</Link>{" "}
          <button type="button" onClick={() => void load()}>I&apos;ve added it</button> · <SignOut />
        </p>
      </section>
    );
  }
  return (
    <section>
      <h1>ASCENTRA isn&apos;t available for this account</h1>
      <p>{s.reason}</p>
      <p><SignOut /></p>
    </section>
  );
}

/** R1: step 4 for an adult: choose Basic or Pro (Basic can start with the 14-day trial). The billing panel is the same as on Account. */
function PlanStep() {
  return (
    <section aria-labelledby="plan-step-h">
      <h1 id="plan-step-h">Choose your plan</h1>
      <p className="muted">Last step. Your answers and picks are saved. Choose a plan to start learning; you can change or cancel it later from Account.</p>
      <BillingPanel returnTo="welcome" />
      <p className="small"><SignOut /></p>
    </section>
  );
}

function DobStep({ onDone, onRefused }: { onDone: (s: State) => void; onRefused: () => void }) {
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const [y, setY] = useState("");
  const [us, setUs] = useState(false);
  const [notUs, setNotUs] = useState(false);
  // C2: the learner's state, private, asked right after the date of birth. Optional here; it can be added in Account.
  const [usState, setUsState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usBox = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!m || !/^\d{1,2}$/.test(d.trim()) || !/^\d{4}$/.test(y.trim())) {
      setError("Enter a real date, like March 4 2001.");
      return;
    }
    // R1: never move on silently. The server still checks this (US_ONLY); this only says so before sending.
    if (!us) {
      setError(US_CONFIRM);
      usBox.current?.focus();
      return;
    }
    setBusy(true);
    let timeZone: string | undefined;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { timeZone = undefined; }
    const r = await call("POST", "/api/registration", { dateOfBirth: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`, usResident: us, ...(usState ? { usState } : {}), ...(timeZone ? { timeZone } : {}) });
    setBusy(false);
    if (r._status === 403 && r.error === "not_eligible") return onRefused();
    if (r._status === 200 || r._status === 201) return onDone(r as unknown as State);
    setError(r.reason ?? "Something went wrong. Nothing was saved.");
  }

  return (
    <form onSubmit={submit} noValidate className="ui-form">
      <h1>What&apos;s your date of birth?</h1>
      <p className="muted">We use it to set up the right kind of account. It isn&apos;t shown on your profile, and you can&apos;t change it later yourself.</p>
      <fieldset className="dob">
        <legend>Date of birth</legend>
        <label>
          Month{" "}
          <select value={m} onChange={(e) => setM(e.target.value)} aria-invalid={!!error}>
            <option value="">Month</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={String(i + 1)}>{name}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Day <input inputMode="numeric" maxLength={2} size={3} value={d} onChange={(e) => setD(e.target.value)} autoComplete="off" aria-invalid={!!error} />
        </label>{" "}
        <label>
          Year <input inputMode="numeric" maxLength={4} size={5} value={y} onChange={(e) => setY(e.target.value)} autoComplete="off" aria-invalid={!!error} />
        </label>
      </fieldset>
      <p>
        <label className="ui-consent">
          <input ref={usBox} type="checkbox" checked={us} onChange={(e) => { setUs(e.target.checked); setNotUs(false); if (e.target.checked) setError(null); }}
            aria-describedby={error === US_CONFIRM ? "dob-error" : undefined} aria-invalid={error === US_CONFIRM} /> I live in the United States
        </label>
      </p>
      <p>
        <label className="ui-stacked">
          Your state (private){" "}
          <select value={usState} onChange={(e) => setUsState(e.target.value)} aria-describedby="dob-state-hint">
            <option value="">Choose…</option>
            {Object.entries(US_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <span id="dob-state-hint" className="ui-hint">Only you, ASCENTRA&apos;s systems and authorized staff see it. It decides which real-world practice missions are open to teens. You can add or change it later in Account.</span>
      </p>
      {notUs && <p role="alert" className="notice">{US_ONLY_TEXT}</p>}
      {error && <p role="alert" id="dob-error">{error}</p>}
      <p className="ui-actions">
        <button type="submit" className="primary" disabled={busy}>Continue</button> · <SignOut />
      </p>
      <p className="small">
        <button type="button" className="link" onClick={() => { setUs(false); setError(null); setNotUs(true); }}>I don&apos;t live in the United States</button>
      </p>
    </form>
  );
}

const STEPS: [Progress, string][] = [
  ["invited", "Your Guardian gets an email invitation to sign up"],
  ["joined", "Your Guardian signs up and confirms their identity and that they're an adult"],
  ["verified", "Your Guardian reviews and agrees to your Teen Terms and Minor Privacy Notice"],
  ["agreed", "Your Guardian chooses your plan and pays for it"],
];
const ORDER: Progress[] = ["none", "invited", "joined", "verified", "agreed"];

function GuardianStep({ s, onDone }: { s: Extract<State, { state: "guardian" }>; onDone: (s: State) => void }) {
  const canChange = s.progress === "none" || s.progress === "invited" || s.progress === "failed";
  const [editing, setEditing] = useState(!s.guardianEmail);
  const [value, setValue] = useState(s.guardianEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent | null, resend = false) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    const r = await call("POST", "/api/registration/guardian", { guardianEmail: value, resend });
    setBusy(false);
    if (r._status === 200 || r._status === 201) {
      setEditing(false);
      return onDone(r as unknown as State);
    }
    setError(r.reason ?? "Something went wrong. Nothing was saved.");
  }

  if (editing || !s.guardianEmail) {
    return (
      <form onSubmit={(e) => void submit(e)} noValidate className="ui-form">
        <h1>A parent or guardian sets this up with you</h1>
        {s.progress === "failed" && <p role="alert">The adult you invited couldn&apos;t be verified as your Guardian. Invite a different parent or guardian.</p>}
        <p>
          For learners 14 to 17, your Guardian authorizes the account and the subscription. Until then your account waits:
          learning, billing and messages stay off.
        </p>
        <p>
          <label className="ui-stacked">
            Your parent or guardian&apos;s email{" "}
            <input type="email" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" aria-invalid={!!error} />
          </label>
        </p>
        {error && <p role="alert">{error}</p>}
        <p className="ui-actions">
          <button type="submit" className="primary" disabled={busy}>Invite my Guardian</button> · <SignOut />
        </p>
      </form>
    );
  }
  const at = ORDER.indexOf(s.progress);
  return (
    <section>
      <h1>Waiting for your Guardian</h1>
      <p>Your account stays paused until your Guardian finishes setup. You don&apos;t need to do anything else right now.</p>
      <ol className="ui-steps">
        {STEPS.map(([step, text]) => (
          <li key={step} data-state={ORDER.indexOf(step) < at ? "done" : ORDER.indexOf(step) === at ? "now" : "next"}>
            {text}: {ORDER.indexOf(step) < at ? "done" : ORDER.indexOf(step) === at ? "in progress" : "next"}
            {step === "invited" && ` (${s.guardianEmail}${s.emailSent ? "" : ", not sent yet"})`}
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
      {canChange && (
        <p className="ui-actions">
          <button type="button" className="link" disabled={busy} onClick={() => void submit(null, true)}>Send the invitation again</button> ·{" "}
          <button type="button" className="link" onClick={() => setEditing(true)}>Use a different email</button> · <SignOut />
        </p>
      )}
      {!canChange && <p><SignOut /></p>}
    </section>
  );
}

/** The Guardian's sign-up step, from the invitation email. */
function GuardianSignup({ teenName, onDone }: { teenName: string; onDone: (s: State) => void }) {
  const [adult, setAdult] = useState(false);
  const [us, setUs] = useState(false);
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await call("POST", "/api/registration/guardian-account", { adult, usResident: us, relationship });
    setBusy(false);
    if (r._status === 200 || r._status === 201) return onDone(r as unknown as State);
    setError(r.reason ?? "Something went wrong. Nothing was saved.");
  }

  return (
    <form onSubmit={submit} noValidate className="ui-form">
      <h1>Be {teenName}&apos;s Guardian on ASCENTRA</h1>
      <p>
        {teenName} asked you to set up their account. This is your own Guardian account, separate from {teenName}&apos;s. Next
        you&apos;ll confirm your identity and that you&apos;re an adult, review what {teenName}&apos;s account includes,
        and choose the plan you pay for.
      </p>
      <fieldset>
        <legend>You are {teenName}&apos;s</legend>
        <span className="ui-pills">
          <label className="ui-pill"><input type="radio" name="rel" value="parent" checked={relationship === "parent"} onChange={() => setRelationship("parent")} /> Parent</label>{" "}
          <label className="ui-pill"><input type="radio" name="rel" value="legal_guardian" checked={relationship === "legal_guardian"} onChange={() => setRelationship("legal_guardian")} /> Legal guardian</label>
        </span>
      </fieldset>
      <p><label className="ui-consent"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> I&apos;m 18 or older</label></p>
      <p><label className="ui-consent"><input type="checkbox" checked={us} onChange={(e) => setUs(e.target.checked)} /> I live in the United States</label></p>
      {error && <p role="alert">{error}</p>}
      <p className="ui-actions">
        <button type="submit" className="primary" disabled={busy}>Continue</button> · <SignOut />
      </p>
    </form>
  );
}
