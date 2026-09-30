import Link from "next/link";
import { ProGate } from "./pro-gate";

// Pro-only. The page asks the API, which reads this account's entitlement from the database; Basic and
// trial accounts get 403 and see why.
export default function ProPage() {
  return (
    <main>
      <p className="muted"><Link href="/">Home</Link> · <Link href="/account">Account</Link></p>
      <h1>Pro tools</h1>
      <ProGate />
    </main>
  );
}
