import Link from "next/link";
import { SourceLibrary } from "./source-library";

export default function SourcesPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/courses">Course builder</Link> · <Link href="/admin/audit">Audit log</Link>
      </p>
      <h1>Source library</h1>
      <p className="muted">
        Only approved sources are searched or cited. Every claim keeps its citation, or is marked as having none. When two
        sources disagree, a Reviewer records which one is followed, and why. Every change here is in the audit log.
      </p>
      <SourceLibrary />
    </main>
  );
}
