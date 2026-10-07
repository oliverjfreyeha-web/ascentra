import Link from "next/link";
import { RequestQueue } from "./request-queue";

export default function CourseRequestsPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/catalog">Topic catalog</Link> · <Link href="/admin/courses">Course builder</Link></p>
      <h1>Course requests</h1>
      <p className="muted">
        Topics learners asked for that have no published course yet, with the level and how many asked. Anonymous by design: only the topic
        and level are kept, never who asked.
      </p>
      <RequestQueue />
    </main>
  );
}
