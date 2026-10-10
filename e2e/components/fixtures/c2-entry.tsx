/**
 * C2: mounts the real C2 screens for the component tests (e2e/components/progress-paths.spec.ts). Bundled with esbuild
 * at test time; Clerk, the Next router and next/link are stood in for, and the API is answered by the test with shapes
 * taken from the real routes (tests/integration/progress-paths.test.ts).
 */
import { createRoot } from "react-dom/client";
import { ChoosePage } from "../../../app/learn/choose/choose-page";
import { ProgressView } from "../../../app/learn/progress/progress-view";
import { NotebookView } from "../../../app/learn/notebook/notebook-view";
import { LeaderboardView } from "../../../app/learn/leaderboard/leaderboard-view";
import { CommunityView } from "../../../app/community/community-view";
import { CapstoneView } from "../../../app/learn/capstone/[courseId]/capstone-view";
import { ProgressSettings } from "../../../app/account/progress-settings";
import { MissionApprovals } from "../../../app/guardian/mission-approvals";
import { MissionsAdmin } from "../../../app/admin/missions/missions-admin";
import { TopicsAdmin } from "../../../app/admin/topics/topics-admin";
import { CourseStudio } from "../../../app/admin/courses/[slug]/course-studio";
import { LessonReader } from "../../../app/learn/[id]/lesson-reader";
import { WelcomeFlow } from "../../../app/welcome/welcome-flow";

const view = (window as unknown as { __view: string }).__view;
const VIEWS: Record<string, () => React.ReactNode> = {
  choose: () => <main className="ui-main-wide"><h1>Choose your path</h1><ChoosePage /></main>,
  progress: () => <main className="ui-main-wide"><h1>My progress</h1><ProgressView /></main>,
  notebook: () => <main className="ui-main-wide"><h1>Notebook</h1><NotebookView /></main>,
  leaderboard: () => <main className="ui-main-wide"><h1>Leaderboard</h1><LeaderboardView /></main>,
  community: () => <main className="ui-main-wide"><h1>Community</h1><CommunityView /></main>,
  capstone: () => <main className="ui-main-wide"><CapstoneView courseId="00000000-0000-4000-8000-000000000050" /></main>,
  account: () => <main className="ui-main-wide"><h1>Account</h1><ProgressSettings /></main>,
  guardian: () => <main className="ui-main-wide"><h1>Guardian Center</h1><MissionApprovals /></main>,
  missions: () => <main className="wide ui-admin"><h1>Missions and leaderboard</h1><MissionsAdmin /></main>,
  topics: () => <main className="wide ui-admin"><h1>Topics</h1><TopicsAdmin /></main>,
  studio: () => <main className="wide ui-admin"><h1>Course</h1><CourseStudio slug="seo-services" /></main>,
  lesson: () => <main className="ui-main-wide ui-lesson"><LessonReader id="00000000-0000-4000-8000-000000000060" /></main>,
  dob: () => <main className="ui-main-wide"><WelcomeFlow /></main>,
};
createRoot(document.getElementById("root")!).render(VIEWS[view]());
