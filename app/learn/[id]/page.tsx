import Link from "next/link";
import { LessonReader } from "./lesson-reader";

export default async function LessonPage({ params }: PageProps<"/learn/[id]">) {
  const { id } = await params;
  return (
    <main>
      <p className="muted"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></p>
      <LessonReader id={id} />
    </main>
  );
}
