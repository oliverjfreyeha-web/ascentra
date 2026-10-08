import Link from "next/link";
import { CourseBuilder } from "./course-builder";
import { ActivityLibrary } from "./activity-library";

export default async function CoursePage({ params }: PageProps<"/admin/courses/[slug]">) {
  const { slug } = await params;
  return (
    <main className="wide ui-admin">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/courses">Course builder</Link> · <Link href="/admin/sources">Source library</Link> · <Link href="/admin/catalog">Topic catalog</Link>
      </p>
      <CourseBuilder slug={slug} />
      <ActivityLibrary slug={slug} />
    </main>
  );
}
