"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { call } from "../call";
import { SignOut } from "../sign-out";

type State =
  | { state: "dob" }
  | { state: "guardian"; guardianEmail: string | null }
  | { state: "second_factor" }
  | { state: "ready" }
  | { state: "not_open"; reason: string };

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
    else setFailed(r._status === 401 ? null : "Couldn't load your account. Reload the page to try again.");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the server's state once signed in
    if (isSignedIn) void load();
  }, [isSignedIn, load]);

  useEffect(() => {
    if (s?.state === "ready") router.replace("/account");
  }, [s, router]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <p>
        <Link href="/sign-in">Sign in</Link> or <Link href="/sign-up">create an account</Link>.
      </p>
    );
  }
  if (failed) return <p role="alert">{failed}</p>;
  if (!s || s.state === "ready") return <p className="muted">Checking your account…</p>;
  if (s.state === "dob") return <DobStep onDone={setS} onRefused={() => void signOut({ redirectUrl: "/not-available" }).catch(() => router.replace("/not-available"))} />;
  if (s.state === "guardian") return <GuardianStep email={s.guardianEmail} onDone={setS} />;
  if (s.state === "second_factor") {
    return (
      <section>
        <h1>One more step: a second factor</h1>
        <p>
          This account needs a second factor before anything else works (a password always needs one, and so does every
          administrator). Add an authenticator app under <Link href="/account">Account → Sign-in methods</Link>, then come
          back here. It can take a few seconds to register.
        </p>
        <p>
          <button type="button" className="primary" onClick={() => void load()}>I&apos;ve added it</button> · <SignOut />
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

function DobStep({ onDone, onRefused }: { onDone: (s: State) => void; onRefused: () => void }) {
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const [y, setY] = useState("");
  const [us, setUs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!m || !/^\d{1,2}$/.test(d.trim()) || !/^\d{4}$/.test(y.trim())) {
      setError("Enter a real date, like March 4 2001.");
      return;
    }
    setBusy(true);
    const r = await call("POST", "/api/registration", { dateOfBirth: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`, usResident: us });
    setBusy(false);
    if (r._status === 403 && r.error === "not_eligible") return onRefused();
    if (r._status === 200 || r._status === 201) return onDone(r as unknown as State);
    setError(r.reason ?? "Something went wrong. Nothing was saved.");
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>What&apos;s your date of birth?</h1>
      <p className="muted">We use it to set up the right kind of account. It isn&apos;t shown on your profile, and you can&apos;t change it later yourself.</p>
      <fieldset>
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
        <label>
          <input type="checkbox" checked={us} onChange={(e) => setUs(e.target.checked)} /> I live in the United States
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      <p>
        <button type="submit" className="primary" disabled={busy}>Continue</button> · <SignOut />
      </p>
    </form>
  );
}

function GuardianStep({ email, onDone }: { email: string | null; onDone: (s: State) => void }) {
  const [editing, setEditing] = useState(!email);
  const [value, setValue] = useState(email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await call("POST", "/api/registration/guardian", { guardianEmail: value });
    setBusy(false);
    if (r._status === 200 || r._status === 201) {
      setEditing(false);
      return onDone(r as unknown as State);
    }
    setError(r.reason ?? "Something went wrong. Nothing was saved.");
  }

  if (editing) {
    return (
      <form onSubmit={submit} noValidate>
        <h1>A parent or guardian sets this up with you</h1>
        <p>
          For learners 14 to 17, your Guardian authorizes the account and the subscription. Until then your account waits:
          learning, billing and messages stay off.
        </p>
        <p>
          <label>
            Your parent or guardian&apos;s email{" "}
            <input type="email" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" aria-invalid={!!error} />
          </label>
        </p>
        {error && <p role="alert">{error}</p>}
        <p>
          <button type="submit" className="primary" disabled={busy}>Invite my Guardian</button> · <SignOut />
        </p>
      </form>
    );
  }
  return (
    <section>
      <h1>Waiting for your Guardian</h1>
      <p>Your account stays paused until your Guardian finishes setup. You don&apos;t need to do anything else right now.</p>
      <ol>
        <li>Invitation for {email}: saved. It will be sent when Guardian sign-up opens.</li>
        <li>Your Guardian confirms they&apos;re an adult.</li>
        <li>Your Guardian reviews the terms and activates the plan.</li>
        <li>You start learning.</li>
      </ol>
      <p>
        <button type="button" className="link" onClick={() => setEditing(true)}>Use a different email</button> · <SignOut />
      </p>
    </section>
  );
}
