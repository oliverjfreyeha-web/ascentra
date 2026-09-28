import Link from "next/link";
import { SignOutButton, UserProfile } from "@clerk/nextjs";

// Passkeys, password and second factor are managed by Clerk. ASCENTRA stores none of them.
export default function AccountPage() {
  return (
    <main>
      <p className="muted">
        <Link href="/">Home</Link> ·{" "}
        <SignOutButton>
          <button type="button" className="link">
            Sign out
          </button>
        </SignOutButton>
      </p>
      <h1>Account security</h1>
      <UserProfile routing="hash" />
    </main>
  );
}
