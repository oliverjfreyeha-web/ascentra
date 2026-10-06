import Link from "next/link";
import { PathPage } from "./path-page";

export default function MyPathPage() {
  return (
    <main>
      <p className="muted"><Link href="/">Home</Link> · <Link href="/learn">Learn</Link></p>
      <h1>My path</h1>
      <PathPage />
    </main>
  );
}
