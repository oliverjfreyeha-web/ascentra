import Link from "next/link";
import { TopicCatalog } from "./topic-catalog";

export default function CatalogPage() {
  return (
    <main className="wide">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/courses">Course builder</Link> · <Link href="/admin/sources">Source library</Link></p>
      <h1>Topic catalog</h1>
      <p className="muted">
        Every learnable topic from the Academy Blueprint, and every course, with where it stands. Queued topics are researched and drafted
        overnight, one course at a time, inside the AI spend caps. Each stops when a person is needed. Everything AI writes is a Draft until
        a Reviewer approves it and it is published.
      </p>
      <TopicCatalog />
    </main>
  );
}
