import Link from "next/link";
import { CourseBuilder } from "./course-builder";

export default async function CoursePage({ params }: PageProps<"/admin/courses/[slug]">) {
  const { slug } = await params;
  return (
    <main className="wide">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/courses">Course builder</Link> · <Link href="/admin/sources">Source library</Link>
      </p>
      <CourseBuilder slug={slug} />
    </main>
  );
}
