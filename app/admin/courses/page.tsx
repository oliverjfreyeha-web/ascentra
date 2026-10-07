import Link from "next/link";
import { CourseList } from "./course-list";

export default function CoursesPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/sources">Source library</Link> · <Link href="/admin/audit">Audit log</Link>
      </p>
      <h1>Course builder</h1>
      <p className="muted">
        AI drafts, people approve. A Blueprint is proposed from approved sources only; a person edits or approves it before any
        lesson is written. Each lesson is a Draft until a Reviewer verifies it and it is published. Learners only ever see
        published versions.
      </p>
      <CourseList />
    </main>
  );
}
