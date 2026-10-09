"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { call } from "./call";

/**
 * R1: pages a learner reaches after sign-up (Home, Learn) send them back to /welcome while a sign-up step is
 * unfinished (the interview, or an adult's plan). The server decides the state; this only follows it.
 */
export function useOnboardingGuard() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    void call("GET", "/api/registration").then((r) => {
      if (live && r._status === 200 && typeof r.state === "string" && r.state !== "ready") router.replace("/welcome");
    }).catch(() => undefined);
    return () => { live = false; };
  }, [isSignedIn, router]);
}
