import Link from "next/link";
import { MissionsAdmin } from "./missions-admin";

export default function MissionsPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/topics">Topics</Link> · <Link href="/community">Community</Link></p>
      <h1>Missions and leaderboard</h1>
      <p className="muted">
        Where teens may do real-world practice missions (off everywhere until you turn a kind on for a state), and leaderboard nicknames.
        Owner only. Every change needs a reason and is recorded in the audit log.
      </p>
      <MissionsAdmin />
    </main>
  );
}
