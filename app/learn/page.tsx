import Link from "next/link";
import { LearnList } from "./learn-list";

export default function LearnPage() {
  return (
    <main>
      <p className="muted"><Link href="/">Home</Link></p>
      <h1>Learn</h1>
      <LearnList />
    </main>
  );
}
