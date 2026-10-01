import Link from "next/link";
import { SignOut } from "../sign-out";
import { GuardianCenter } from "./guardian-center";

export default function GuardianPage() {
  return (
    <main>
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/account">Account and devices</Link> · <SignOut />
      </p>
      <h1>Guardian Center</h1>
      <GuardianCenter />
    </main>
  );
}
