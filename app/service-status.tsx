"use client";

import { useEffect, useState } from "react";
import { STATUS_LABELS, type ConnectionStatus, type ServiceName } from "@/lib/connection-status";

const SERVICES: { key: ServiceName; name: string }[] = [
  { key: "supabase", name: "Database (Supabase)" },
  { key: "clerk", name: "Authentication (Clerk)" },
];

type Health = { version: string; time: string; cached: boolean; services: Record<ServiceName, ConnectionStatus> };
type State = { phase: "checking" } | { phase: "failed" } | { phase: "done"; health: Health };

// Reads status only through the API. Until the API answers, every service shows Disconnected.
export function ServiceStatus() {
  const [state, setState] = useState<State>({ phase: "checking" });

  useEffect(() => {
    let live = true;
    fetch("/api/v1/health", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Health>) : Promise.reject(new Error(String(res.status)))))
      .then((health) => live && setState({ phase: "done", health }))
      .catch(() => live && setState({ phase: "failed" }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="svc-h">
      <h2 id="svc-h" className="muted">
        Services
      </h2>
      <ul className="services">
        {SERVICES.map(({ key, name }) => {
          const s = state.phase === "done" ? state.health.services[key] : undefined;
          const status = s?.status === "connected" ? "connected" : "disconnected";
          const meta = STATUS_LABELS[status];
          const detail =
            state.phase === "checking"
              ? "Checking…"
              : state.phase === "failed"
                ? "The health check didn't finish."
                : s?.status === "connected"
                  ? s.evidence
                  : s?.reason;
          return (
            <li key={key} data-service={key} data-status={status}>
              <div className="row">
                <span>{name}</span>
                <span className={`st st-${status}`} title={meta.help}>
                  <span aria-hidden="true">{meta.glyph}</span>
                  {meta.label}
                </span>
              </div>
              {detail && <div className="muted">{detail}</div>}
            </li>
          );
        })}
      </ul>
      {state.phase === "done" && (
        <p className="muted">
          Version {state.health.version} · checked {state.health.services.supabase.checkedAt}
          {state.health.cached ? " (cached)" : ""}
        </p>
      )}
    </section>
  );
}
