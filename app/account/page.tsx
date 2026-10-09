import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { SignOut } from "../sign-out";
import { BillingPanel } from "./billing-panel";
import { DevicesPanel } from "./devices-panel";
import { PrivacyCenter } from "./privacy-center";
import { AppearancePanel } from "./appearance-panel";
import { ProtectTip } from "../ui/protect-tip";
import { SiteFooter } from "../ui/site-footer";
import { Reveal } from "../ui/reveal";

// Passkeys, password and second factor are managed by Clerk. ASCENTRA stores none of them.
export default function AccountPage() {
  return (
    <main className="ui-main-wide">
      <Reveal selector=".ui-block, .ui-course, .ui-path > li" />
      <nav className="ui-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link> · <SignOut />
      </nav>
      <header className="ui-page-head">
        <h1>Account and devices</h1>
      </header>
      <ProtectTip where="account" />
      <BillingPanel />
      <PrivacyCenter />
      <div className="ui-block"><DevicesPanel /></div>
      <section className="ui-block" id="appearance" aria-labelledby="appearance-h"><AppearancePanel /></section>
      <section className="ui-block ui-clerk" id="sign-in-methods" aria-labelledby="sign-in-methods-h">
        <h2 id="sign-in-methods-h">Sign-in methods</h2>
        <p className="small muted">For a learner, an authenticator app is optional and recommended: open <b>Security</b> below to add one.</p>
        <UserProfile routing="hash" />
      </section>
      <SiteFooter />
    </main>
  );
}
