import Link from "next/link";
import { LearnList } from "./learn-list";
import { SiteFooter } from "../ui/site-footer";
import { Reveal } from "../ui/reveal";

export default function LearnPage() {
  return (
    <main className="ui-main-wide">
      <Reveal selector=".ui-block, .ui-course, .ui-path > li" />
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link></nav>
      <header className="ui-page-head">
        <h1>Learn</h1>
      </header>
      <LearnList />
      <SiteFooter />
    </main>
  );
}
