import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { SignOut } from "../sign-out";
import { BillingPanel } from "./billing-panel";
import { DevicesPanel } from "./devices-panel";
import { PrivacyCenter } from "./privacy-center";

// Passkeys, password and second factor are managed by Clerk. ASCENTRA stores none of them.
export default function AccountPage() {
  return (
    <main>
      <p className="muted">
        <Link href="/">Home</Link> · <SignOut />
      </p>
      <h1>Account and devices</h1>
      <BillingPanel />
      <PrivacyCenter />
      <DevicesPanel />
      <h2>Sign-in methods</h2>
      <UserProfile routing="hash" />
    </main>
  );
}
