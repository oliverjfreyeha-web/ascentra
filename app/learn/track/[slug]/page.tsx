import Link from "next/link";
import { TrackView } from "./track-view";
import { SiteFooter } from "../../../ui/site-footer";

export default async function TrackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link></nav>
      <header className="ui-page-head">
        <h1>Skill track</h1>
      </header>
      <TrackView slug={slug} />
      <SiteFooter />
    </main>
  );
}
