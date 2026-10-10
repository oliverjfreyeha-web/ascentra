import Link from "next/link";
import { LeaderboardView } from "./leaderboard-view";
import { SiteFooter } from "../../ui/site-footer";

export default function LeaderboardPage() {
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link></nav>
      <header className="ui-page-head">
        <h1>Leaderboard</h1>
      </header>
      <LeaderboardView />
      <SiteFooter />
    </main>
  );
}
