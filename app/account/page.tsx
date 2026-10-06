import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { SignOut } from "../sign-out";
import { BillingPanel } from "./billing-panel";
import { DevicesPanel } from "./devices-panel";
import { PrivacyCenter } from "./privacy-center";

// Passkeys, password and second factor are managed by Clerk. ASCENTRA stores none of them.
export default function AccountPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link> · <SignOut />
      </nav>
      <header className="ui-page-head">
        <h1>Account and devices</h1>
      </header>
      <BillingPanel />
      <PrivacyCenter />
      <div className="ui-block"><DevicesPanel /></div>
      <section className="ui-block ui-clerk">
        <h2>Sign-in methods</h2>
        <UserProfile routing="hash" />
      </section>
    </main>
  );
}
