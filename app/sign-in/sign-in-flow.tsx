"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignIn, useAuth, useSignIn } from "@clerk/nextjs";

// Passkey first. Password with a second factor, and recovery through a verified email
// ("Forgot password?"), are handled by Clerk's own form behind the fallback link.
export function SignInFlow() {
  const { isLoaded } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function withPasskey() {
    setMessage(null);
    const { error } = await signIn.passkey({ flow: "discoverable" });
    if (error) {
      setMessage("That passkey didn't work. Try again, or use your password and second factor.");
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize();
      router.replace("/");
    } else {
      setMessage("Sign-in needs another step. Use your password and second factor.");
      setFallback(true);
    }
  }

  if (fallback) {
    return (
      <section aria-label="Password sign-in">
        <SignIn routing="hash" withSignUp={false} fallbackRedirectUrl="/" />
        <p className="muted">
          <button type="button" className="link" onClick={() => setFallback(false)}>
            Use a passkey instead
          </button>
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Passkey sign-in">
      <button type="button" className="primary" onClick={withPasskey} disabled={!isLoaded || fetchStatus === "fetching"}>
        Sign in with a passkey
      </button>
      {message && (
        <p role="alert" className="muted">
          {message}
        </p>
      )}
      <p className="muted">
        <button type="button" className="link" onClick={() => setFallback(true)}>
          Use password and a second factor
        </button>
      </p>
      <p className="muted">
        New to ASCENTRA? <Link href="/sign-up">Create an account</Link>
      </p>
    </section>
  );
}
