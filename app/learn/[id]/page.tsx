import Link from "next/link";
import { LessonReader } from "./lesson-reader";

export default async function LessonPage({ params }: PageProps<"/learn/[id]">) {
  const { id } = await params;
  return (
    <main className="ui-main-wide ui-lesson">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></nav>
      <LessonReader id={id} />
    </main>
  );
}
