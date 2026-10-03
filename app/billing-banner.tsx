"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

type Alert = { kind: string; forAccountId: string; message: string; href: string };

/** B4: a failed payment is shown on every page until it's fixed (the API decides; nothing here is trusted). */
export function BillingBanner() {
  const { isSignedIn } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    fetch("/api/v1/billing/alerts", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { alerts: Alert[] }).alerts : []))
      .then((a) => live && setAlerts(a))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isSignedIn]);
  if (!isSignedIn || !alerts.length) return null;
  return (
    <div role="alert" className="notice banner">
      {alerts.map((a) => (
        <p key={a.forAccountId + a.kind}>
          {a.message} <Link href={a.href}>Plan and billing</Link>
        </p>
      ))}
    </div>
  );
}
