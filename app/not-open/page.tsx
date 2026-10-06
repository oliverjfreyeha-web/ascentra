import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";

export default function NotOpenPage() {
  return (
    <main>
      <div className="ui-auth ui-auth--wide"><div className="ui-auth__card">
      <h1>ASCENTRA isn&apos;t open yet</h1>
      <p>This account doesn&apos;t have access.</p>
      <p className="muted">
        If you were invited: your email must be verified, and if you sign in with a password you also need a second
        factor. Administrators always need a second factor; the role starts working once it&apos;s on. You can add one
        in <Link href="/account">account security</Link>.
      </p>
      <SignOutButton>
        <button type="button">Sign out</button>
      </SignOutButton>
      </div></div>
    </main>
  );
}
