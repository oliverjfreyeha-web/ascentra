import Link from "next/link";
import { CommunityView } from "./community-view";
import { SiteFooter } from "../ui/site-footer";

export default function CommunityPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <header className="ui-page-head">
        <h1>Community</h1>
      </header>
      <CommunityView />
      <SiteFooter />
    </main>
  );
}
