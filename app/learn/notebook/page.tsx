import Link from "next/link";
import { NotebookView } from "./notebook-view";
import { SiteFooter } from "../../ui/site-footer";

export default function NotebookPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link></nav>
      <header className="ui-page-head">
        <h1>Notebook</h1>
      </header>
      <NotebookView />
      <SiteFooter />
    </main>
  );
}
