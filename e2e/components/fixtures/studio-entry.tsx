/**
 * C1: mounts the real course studio and Owner review screens for the component tests (e2e/components/course-studio.spec.ts).
 * Bundled with esbuild at test time; Clerk and next/link are stood in for (see the spec), and the API is answered by the
 * test with shapes taken from the real routes.
 */
import { createRoot } from "react-dom/client";
import { CourseStudio } from "../../../app/admin/courses/[slug]/course-studio";
import { ReviewChecklist } from "../../../app/admin/review/review-checklist";
import { BoostersPanel } from "../../../app/admin/review/boosters-panel";
import { LessonVideos } from "../../../app/learn/[id]/lesson-videos";

const view = (window as unknown as { __view: string }).__view;
const root = createRoot(document.getElementById("root")!);
root.render(
  view === "review" ? <main className="wide ui-admin"><ReviewChecklist /><BoostersPanel /></main>
    : view === "videos" ? <main><LessonVideos videos={[
      { id: "33333333-3333-4333-8333-333333333331", title: "Test video 1", state: "ready", transcript: "Test transcript: what a good first line looks like." },
      { id: "33333333-3333-4333-8333-333333333332", title: "Test video 2", state: "coming", transcript: null },
    ]} /></main>
      : <main className="wide ui-admin"><CourseStudio slug="cold-outreach" /></main>,
);
