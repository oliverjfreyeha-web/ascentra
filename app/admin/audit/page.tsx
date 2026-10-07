import Link from "next/link";
import { AuditLog } from "./audit-log";

export default function AuditPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin">Administrators</Link>
      </p>
      <h1>Audit log</h1>
      <p className="muted">Append-only. Every event is chained to the one before it, so a changed or missing event shows up as a break.</p>
      <AuditLog />
    </main>
  );
}
