import Link from "next/link";
import { SignOut } from "../sign-out";
import { GuardianCenter } from "./guardian-center";

export default function GuardianPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link> · <Link href="/account">Account and devices</Link> · <SignOut />
      </nav>
      <header className="ui-page-head">
        <h1>Guardian Center</h1>
      </header>
      <GuardianCenter />
    </main>
  );
}
