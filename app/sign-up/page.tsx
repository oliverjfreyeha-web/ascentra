import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

// Clerk's sign-up form. After it, /welcome asks for the date of birth before anything else unlocks.
export default function SignUpPage() {
  return (
    <main>
      <h1>Create an ASCENTRA account</h1>
      <p className="muted">ASCENTRA is available in the United States.</p>
      <SignUp routing="hash" signInUrl="/sign-in" forceRedirectUrl="/welcome" />
      <p className="muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
