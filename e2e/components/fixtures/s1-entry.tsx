/**
 * S1: mounts the skill track screens for the component tests (e2e/components/skill-tracks.spec.ts): the track view,
 * the library view, My progress with a track, and the topics admin's skill rows. Clerk, the Next router and next/link are
 * stood in for; the API is answered by the test with the real routes' shapes (tests/integration/skill-tracks.test.ts).
 */
import { createRoot } from "react-dom/client";
import { TrackView } from "../../../app/learn/track/[slug]/track-view";
import { LibraryView } from "../../../app/learn/track/[slug]/library/library-view";
import { ProgressView } from "../../../app/learn/progress/progress-view";
import { TopicsAdmin } from "../../../app/admin/topics/topics-admin";

const view = (window as unknown as { __view: string }).__view;
const VIEWS: Record<string, () => React.ReactNode> = {
  track: () => <main className="ui-main-wide"><h1>Skill track</h1><TrackView slug="copywriting" /></main>,
  library: () => <main className="ui-main-wide"><h1>Track library</h1><LibraryView slug="copywriting" /></main>,
  progress: () => <main className="ui-main-wide"><h1>My progress</h1><ProgressView /></main>,
  topics: () => <main className="wide ui-admin"><h1>Topics</h1><TopicsAdmin /></main>,
};
createRoot(document.getElementById("root")!).render(VIEWS[view]());
