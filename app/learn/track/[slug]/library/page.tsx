import Link from "next/link";
import { LibraryView } from "./library-view";
import { SiteFooter } from "../../../../ui/site-footer";

export default async function TrackLibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="ui-main-wide ds-page">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link> · <Link href={`/learn/track/${slug}`}>Skill track</Link></nav>
      <header className="ui-page-head">
        <h1>Track library</h1>
      </header>
      <LibraryView slug={slug} />
      <SiteFooter />
    </main>
  );
}
