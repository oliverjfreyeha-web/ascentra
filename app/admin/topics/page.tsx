import Link from "next/link";
import { TopicsAdmin } from "./topics-admin";

export default function TopicsPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/catalog">Topic catalog</Link> · <Link href="/admin/course-requests">Course requests</Link></p>
      <h1>Topics</h1>
      <p className="muted">
        The businesses and skills learners pick on &ldquo;Choose your path&rdquo;. Teens never see a topic marked hidden from teens. A topic
        with no course shows &ldquo;Course coming&rdquo;. Every change here is recorded in the audit log. Topics never promise income or results.
      </p>
      <TopicsAdmin />
    </main>
  );
}
