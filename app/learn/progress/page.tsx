import Link from "next/link";
import { ProgressView } from "./progress-view";
import { SiteFooter } from "../../ui/site-footer";

export default function MyProgressPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <header className="ui-page-head">
        <h1>My progress</h1>
      </header>
      <ProgressView />
      <SiteFooter />
    </main>
  );
}
