import Link from "next/link";
import { PathPage } from "./path-page";
import { SiteFooter } from "../../ui/site-footer";
import { Reveal } from "../../ui/reveal";

export default function MyPathPage() {
  return (
    <main className="ui-main-wide">
      <Reveal selector=".ui-block, .ui-course, .ui-path > li" />
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <header className="ui-page-head">
        <h1>My path</h1>
      </header>
      <PathPage />
      <SiteFooter />
    </main>
  );
}
