import Link from "next/link";
import { PathPage } from "./path-page";
import { SiteFooter } from "../../ui/site-footer";

export default function MyPathPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <header className="ui-page-head">
        <h1>My path</h1>
      </header>
      <PathPage />
      <SiteFooter />
    </main>
  );
}
