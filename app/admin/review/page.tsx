import Link from "next/link";
import { ReviewChecklist } from "./review-checklist";
import { BoostersPanel } from "./boosters-panel";

/** C1: the Owner's review checklist across every course built with the module recipe, and the learning boosters list. */
export default function ReviewPage() {
  return (
    <main className="wide ui-admin">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/courses">Course builder</Link> · <Link href="/admin/topics">Topics</Link></p>
      <h1>Owner review</h1>
      <p className="muted">
        Your approval is the last step before a course is published: module by module, after a Reviewer has verified it. A course
        publishes only when every module is approved for that version. Approve or send back from each course&apos;s studio.
      </p>
      <ReviewChecklist />
      <BoostersPanel />
    </main>
  );
}
