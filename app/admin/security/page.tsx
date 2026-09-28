import Link from "next/link";
import { SecurityConsole } from "./security-console";

export default function SecurityPage() {
  return (
    <main className="wide">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/account">Account and devices</Link>
      </p>
      <h1>Account safeguards</h1>
      <p className="muted">
        Devices, sessions, overlaps and sharing flags for one account, and the appeal queue. Security information only: no payment
        details, notes or Mentor conversations. Every change needs a reason and is recorded in the audit log.
      </p>
      <SecurityConsole />
    </main>
  );
}
