import Link from "next/link";
import { AdjustmentsPanel } from "./adjustments-panel";
import { AdminsPanel } from "./admins-panel";
import { AdminLinks } from "./admin-home";

export default function AdminPage() {
  return (
    <main className="ui-admin">
      <p className="muted">
        <Link href="/">Home</Link> · <Link href="/admin/audit">Audit log</Link> · <Link href="/admin/sources">Source library</Link> · <Link href="/account">Account security</Link>
      </p>
      <h1>Administrators</h1>
      <p className="muted">Only the Owner can grant, change or revoke administrator roles.</p>
      <AdminLinks />
      <AdminsPanel />
      <AdjustmentsPanel />
    </main>
  );
}
