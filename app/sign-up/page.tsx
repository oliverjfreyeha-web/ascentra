import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

// Clerk's sign-up form. After it, /welcome asks for the date of birth before anything else unlocks.
export default function SignUpPage() {
  return (
    <main>
      <div className="ui-auth ui-auth--wide">
        <div className="ui-auth__halo" aria-hidden="true" />
        <div className="ui-auth__card">
          <h1>Create an ASCENTRA account</h1>
          <p className="muted">ASCENTRA is available in the United States.</p>
          <SignUp routing="hash" signInUrl="/sign-in" forceRedirectUrl="/welcome" />
          <p className="muted">
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
