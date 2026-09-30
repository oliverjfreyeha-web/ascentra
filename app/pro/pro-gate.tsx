"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "../call";

export function ProGate() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/pro").then((r) =>
      setState(r._status === 200 ? { ok: true, text: "Your Pro plan is active." } : { ok: false, text: r.reason ?? "This page isn't available." }),
    );
  }, []);
  if (!state) return <p className="muted">Checking your plan…</p>;
  if (state.ok) return <p>{state.text} Pro tools arrive in a later stage.</p>;
  return (
    <p role="alert">
      {state.text} <Link href="/account">Go to Billing</Link>
    </p>
  );
}
