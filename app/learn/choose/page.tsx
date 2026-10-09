import Link from "next/link";
import { ChoosePage } from "./choose-page";
import { SiteFooter } from "../../ui/site-footer";

export default function ChooseYourPathPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <header className="ui-page-head">
        <h1>Choose your path</h1>
      </header>
      <ChoosePage />
      <SiteFooter />
    </main>
  );
}
