import Link from "next/link";
import { ProGate } from "./pro-gate";

// Pro-only. The page asks the API, which reads this account's entitlement from the database; Basic and
// trial accounts get 403 and see why.
export default function ProPage() {
  return (
    <main>
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/account">Account</Link></nav>
      <header className="ui-page-head"><h1>Pro tools</h1></header>
      <div className="ui-block"><ProGate /></div>
    </main>
  );
}
