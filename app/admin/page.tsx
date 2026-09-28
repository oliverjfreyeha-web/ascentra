import Link from "next/link";
import { AdminsPanel } from "./admins-panel";

export default function AdminPage() {
  return (
    <main>
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/audit">Audit log</Link> · <Link href="/account">Account security</Link>
      </p>
      <h1>Administrators</h1>
      <p className="muted">Only the Owner can grant, change or revoke administrator roles.</p>
      <AdminsPanel />
    </main>
  );
}
