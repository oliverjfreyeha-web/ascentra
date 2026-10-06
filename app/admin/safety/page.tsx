import Link from "next/link";
import { SafetyQueue } from "./safety-queue";

export default function SafetyPage() {
  return (
    <main className="wide">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/audit">Audit log</Link></p>
      <h1>Safety review</h1>
      <p className="muted">
        Safety checks on Mentor messages and replies. A teen&apos;s urgent events come first. Each shows who, when, the category and what
        was done, never what was written: Mentor conversations are private to the learner.
      </p>
      <SafetyQueue />
    </main>
  );
}
