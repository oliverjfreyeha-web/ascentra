"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useAuth, useClerk, useReverification } from "@clerk/nextjs";
import { call, when, type ApiResult } from "./call";

type Device = { id: string; name: string; kind: string; region: string | null; trustedAt: string | null; lastSeenAt: string | null };
type Enforcement = {
  step: string | null; label: string | null; text: string | null; reason: string | null; limitUntil: string | null;
  limited: boolean; suspended: boolean; needsVerify: boolean; noticeUnread: boolean;
};
type Beat = ApiResult & {
  heartbeatSeconds: number;
  deviceLimit: number;
  enforcement: Enforcement;
  device: ({ trusted: true } & Device) | { trusted: false; name: string; why: "full" | "limited" } | null;
  devices?: Device[];
  session: null | {
    state: "active" | "paused" | "ended"; conflict: boolean; notice: string | null;
    others: { device: string; region: string | null; since: string; state: string }[];
  };
};

/**
 * Wraps every page. For a signed-in person it registers this device, keeps the session alive with a
 * heartbeat, and stands in front of the page when it has to: the device-limit screen, the Verify
 * check, a suspension, or "ASCENTRA is open on another device." when this session is paused.
 * If the check itself fails, the page still renders: the API enforces the same rules on every call.
 */
export function DeviceGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [beat, setBeat] = useState<Beat | "none" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback(async () => {
    try {
      const r = (await call("POST", "/api/v1/session")) as Beat;
      if (r._status === 401) setBeat("none");
      else if (r._status >= 400) setBeat("error");
      else setBeat(r);
    } catch {
      setBeat("error");
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- signed out: nothing to check
      setBeat("none");
      return;
    }
    void send();
    const onVisible = () => document.visibilityState === "visible" && void send();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isLoaded, isSignedIn, send]);

  // Heartbeat while the page is visible, at the interval the server sets.
  const seconds = typeof beat === "object" && beat ? beat.heartbeatSeconds : null;
  useEffect(() => {
    if (!seconds) return;
    timer.current = setInterval(() => document.visibilityState === "visible" && void send(), seconds * 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [seconds, send]);

  // Signed out from another device, or this device was removed: finish signing out here.
  const ended = typeof beat === "object" && beat?.session?.state === "ended";
  useEffect(() => {
    if (ended) void signOut({ redirectUrl: "/" });
  }, [ended, signOut]);

  // Until Clerk has loaded, the page renders as before (its API calls enforce the same rules).
  if (!isLoaded) return <>{children}</>;
  if (isSignedIn && beat === null) return <main><p className="muted">Checking this device…</p></main>;
  if (beat === "none" || beat === "error" || beat === null) return <>{children}</>;

  const e = beat.enforcement;
  if (e.suspended) return <Suspended enforcement={e} />;
  if (beat.device && !beat.device.trusted) return <NotTrusted beat={beat} onDone={send} />;
  if (e.needsVerify) return <Verify enforcement={e} onDone={send} />;
  if (beat.session?.state === "paused") return <Paused beat={beat} onDone={send} />;
  return (
    <>
      {beat.session?.conflict && <OtherDeviceBanner beat={beat} onDone={send} />}
      {e.noticeUnread && <NoticeBanner enforcement={e} onDone={send} />}
      {children}
    </>
  );
}

function SignOutHere() {
  const { signOut } = useClerk();
  return (
    <button type="button" className="link" onClick={async () => {
      await fetch("/api/v1/session/end", { method: "POST", cache: "no-store" }).catch(() => undefined);
      await signOut({ redirectUrl: "/" });
    }}>
      Sign out here
    </button>
  );
}

function others(beat: Beat) {
  const o = beat.session?.others ?? [];
  return o.length ? o.map((x) => `${x.device}${x.region ? ` (approximately ${x.region})` : ""}`).join(", ") : "another device";
}

function Paused({ beat, onDone }: { beat: Beat; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <section className="notice" role="alert">
        <h1>ASCENTRA is open on another device.</h1>
        <p>A session started on {others(beat)}. ASCENTRA allows one session at a time, so this one is paused. Nothing here is lost.</p>
        <p>Choose which device continues.</p>
        <p>
          <button type="button" className="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            await call("POST", "/api/v1/session/continue");
            setBusy(false);
            onDone();
          }}>Continue here</button>{" "}
          <SignOutHere />
        </p>
      </section>
    </main>
  );
}

function OtherDeviceBanner({ beat, onDone }: { beat: Beat; onDone: () => void }) {
  return (
    <div className="notice banner" role="status">
      <b>ASCENTRA is open on another device.</b> It&apos;s paused on {others(beat)}. Choose which device continues:{" "}
      <button type="button" className="link" onClick={async () => {
        await call("POST", "/api/v1/session/continue");
        onDone();
      }}>Continue here</button>{" · "}
      <SignOutHere />
    </div>
  );
}

function NoticeBanner({ enforcement, onDone }: { enforcement: Enforcement; onDone: () => void }) {
  return (
    <div className="notice banner" role="status">
      <b>Notice.</b> {enforcement.text} <span className="muted">{enforcement.reason}</span>{" "}
      <Link href="/account#safeguards">Details and appeal</Link>{" · "}
      <button type="button" className="link" onClick={async () => {
        await call("POST", "/api/v1/security/notice");
        onDone();
      }}>I understand</button>
    </div>
  );
}

function Verify({ enforcement, onDone }: { enforcement: Enforcement; onDone: () => void }) {
  const verify = useReverification(call);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <main>
      <section className="notice" role="alert">
        <h1>Confirm it&apos;s you</h1>
        <p>{enforcement.text}</p>
        <p className="muted">{enforcement.reason}</p>
        <p>
          <button type="button" className="primary" onClick={async () => {
            try {
              const r = await verify("POST", "/api/v1/security/verify");
              if (r._status >= 400) setMessage(r.reason ?? "That didn't work. Try again.");
              else onDone();
            } catch {
              setMessage("The check was cancelled.");
            }
          }}>Confirm it&apos;s me</button>{" "}
          <SignOutHere />
        </p>
        {message && <p role="alert">{message}</p>}
      </section>
      <details><summary>Appeal</summary><AppealForm /></details>
    </main>
  );
}

function NotTrusted({ beat, onDone }: { beat: Beat; onDone: () => void }) {
  const replace = useReverification(call);
  const [message, setMessage] = useState<string | null>(null);
  const d = beat.device as { trusted: false; name: string; why: "full" | "limited" };
  const devices = beat.devices ?? [];
  const oldest = [...devices].sort((a, b) => String(a.lastSeenAt ?? a.trustedAt).localeCompare(String(b.lastSeenAt ?? b.trustedAt)))[0];

  if (d.why === "limited") {
    return (
      <main>
        <section className="notice" role="alert">
          <h1>New devices are paused</h1>
          <p>{beat.enforcement.text} Until {when(beat.enforcement.limitUntil)}.</p>
          <p className="muted">{beat.enforcement.reason}</p>
          <p><SignOutHere /></p>
        </section>
        <details><summary>Appeal</summary><AppealForm /></details>
      </main>
    );
  }
  return (
    <main>
      <section className="notice" role="alert">
        <h1>Replace a trusted device?</h1>
        <p>
          You already have {beat.deviceLimit} trusted devices. To use ASCENTRA on <b>{d.name}</b>, replace one. You&apos;ll be
          asked for your second factor first. The replaced device is signed out and will need a new sign-in.
        </p>
        <ul className="services">
          {devices.map((x) => (
            <li key={x.id} className="row">
              <span>
                <b>{x.name}</b>{" "}
                <span className="muted">
                  trusted {when(x.trustedAt)} · last active {when(x.lastSeenAt)}{x.region ? ` · approx. ${x.region}` : ""}{x.id === oldest?.id ? " · least recently used" : ""}
                </span>
              </span>
              <button type="button" className={x.id === oldest?.id ? "primary" : "link"} onClick={async () => {
                setMessage(null);
                try {
                  const r = await replace("POST", "/api/v1/devices/replace", { replace: x.id });
                  if (r._status >= 400) setMessage(r.reason ?? "That didn't work.");
                  else onDone();
                } catch {
                  setMessage("The second-factor check was cancelled. Nothing changed.");
                }
              }}>Replace this one</button>
            </li>
          ))}
        </ul>
        {message && <p role="alert">{message}</p>}
        <p><SignOutHere /> <span className="muted">(don&apos;t trust {d.name})</span></p>
      </section>
    </main>
  );
}

function Suspended({ enforcement }: { enforcement: Enforcement }) {
  return (
    <main>
      <section className="notice" role="alert">
        <h1>This account is suspended</h1>
        <p>{enforcement.text}</p>
        <p className="muted">{enforcement.reason}</p>
      </section>
      <AppealForm />
      <p><SignOutHere /></p>
    </main>
  );
}

/** Appeal the current step. A person reviews it before anything else happens. */
export function AppealForm({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await call("POST", "/api/v1/security/appeals", { text });
    if (r._status >= 400) setMessage(r.reason ?? "The appeal wasn't sent.");
    else {
      setMessage(`Appeal ${(r.appeal as { reference: string }).reference} submitted. A person reviews it; nothing else happens automatically.`);
      setText("");
      onDone?.();
    }
  }
  return (
    <form onSubmit={submit} aria-label="Appeal">
      <h2>Appeal</h2>
      <p>
        <label htmlFor="appeal-text">Explain what happened</label>
        <br />
        <textarea id="appeal-text" rows={4} cols={50} value={text} onChange={(e) => setText(e.target.value)} minLength={20} maxLength={2000} required
          placeholder="For example: I switched phones and signed in from a hotel on a trip." />
      </p>
      <button type="submit" className="primary">Submit appeal</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
