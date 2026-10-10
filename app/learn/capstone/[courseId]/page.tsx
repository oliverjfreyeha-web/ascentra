import Link from "next/link";
import { CapstoneView } from "./capstone-view";
import { SiteFooter } from "../../../ui/site-footer";

export default async function CapstonePage({ params }: PageProps<"/learn/capstone/[courseId]">) {
  const { courseId } = await params;
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link></nav>
      <CapstoneView courseId={courseId} />
      <SiteFooter />
    </main>
  );
}
