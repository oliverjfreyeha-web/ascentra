/**
 * Design rebuild D3: the root layout's page-wide pieces (icon gradients, backdrop, cursor effects, pointer listener,
 * lens, sounds, HUD) around a real page chosen by the URL path, for e2e/components/design-shell.spec.ts and the D3
 * screenshots. Clerk, the Next router and next/link are stood in for; the API is answered by the test.
 * Design rebuild D6: every other route's real page, too (pages that await their params are awaited first).
 */
import { createRoot } from "react-dom/client";
import Home from "../../../app/page";
import AccountPage from "../../../app/account/page";
import LearnPage from "../../../app/learn/page";
import MyProgressPage from "../../../app/learn/progress/page";
import AdminPage from "../../../app/admin/page";
import AuditPage from "../../../app/admin/audit/page";
import CatalogPage from "../../../app/admin/catalog/page";
import CourseRequestsPage from "../../../app/admin/course-requests/page";
import CoursesPage from "../../../app/admin/courses/page";
import ImportCoursePage from "../../../app/admin/import/page";
import MissionsPage from "../../../app/admin/missions/page";
import ReviewPage from "../../../app/admin/review/page";
import SafetyPage from "../../../app/admin/safety/page";
import SecurityPage from "../../../app/admin/security/page";
import SourcesPage from "../../../app/admin/sources/page";
import TopicsPage from "../../../app/admin/topics/page";
import GuardianPage from "../../../app/guardian/page";
import CommunityPage from "../../../app/community/page";
import CreditsPage from "../../../app/credits/page";
import ChooseYourPathPage from "../../../app/learn/choose/page";
import LeaderboardPage from "../../../app/learn/leaderboard/page";
import NotebookPage from "../../../app/learn/notebook/page";
import MyPathPage from "../../../app/learn/path/page";
import LessonPage from "../../../app/learn/[id]/page";
import TrackPage from "../../../app/learn/track/[slug]/page";
import TrackLibraryPage from "../../../app/learn/track/[slug]/library/page";
import CapstonePage from "../../../app/learn/capstone/[courseId]/page";
import NotAvailablePage from "../../../app/not-available/page";
import NotOpenPage from "../../../app/not-open/page";
import ProPage from "../../../app/pro/page";
import SignInPage from "../../../app/sign-in/page";
import SignUpPage from "../../../app/sign-up/page";
import WelcomePage from "../../../app/welcome/page";
import NotFound from "../../../app/not-found";
import ErrorPage from "../../../app/error";
import { IconDefs } from "../../../app/ui/design/ds-icon";
import { Backdrop } from "../../../app/ui/backdrop/backdrop";
import { CursorFx } from "../../../app/ui/shell/cursor-fx";
import { AppHud } from "../../../app/ui/shell/app-hud";
import { Spotlight } from "../../../app/ui/spotlight";
import { GlassLens } from "../../../app/ui/glass-lens";
import { UiSoundClicks } from "../../../app/ui/sound/ui-sound-clicks";

const path = window.location.pathname;
const PAGES: Record<string, () => React.ReactNode | Promise<React.ReactNode>> = {
  "/": () => <Home />, "/account": () => <AccountPage />, "/learn": () => <LearnPage />, "/learn/progress": () => <MyProgressPage />,
  "/admin": () => <AdminPage />, "/admin/audit": () => <AuditPage />, "/admin/catalog": () => <CatalogPage />,
  "/admin/course-requests": () => <CourseRequestsPage />, "/admin/courses": () => <CoursesPage />, "/admin/import": () => <ImportCoursePage />,
  "/admin/missions": () => <MissionsPage />, "/admin/review": () => <ReviewPage />, "/admin/safety": () => <SafetyPage />,
  "/admin/security": () => <SecurityPage />, "/admin/sources": () => <SourcesPage />, "/admin/topics": () => <TopicsPage />,
  "/guardian": () => <GuardianPage />, "/community": () => <CommunityPage />, "/credits": () => <CreditsPage />,
  "/learn/choose": () => <ChooseYourPathPage />, "/learn/leaderboard": () => <LeaderboardPage />, "/learn/notebook": () => <NotebookPage />,
  "/learn/path": () => <MyPathPage />, "/not-available": () => <NotAvailablePage />, "/not-open": () => <NotOpenPage />, "/pro": () => <ProPage />,
  "/sign-in": () => <SignInPage />, "/sign-up": () => <SignUpPage />, "/welcome": () => <WelcomePage />, "/missing": () => <NotFound />,
  "/error": () => <ErrorPage error={new Error("test")} reset={() => undefined} />,
};
async function pageFor(p: string): Promise<React.ReactNode> {
  if (PAGES[p]) return PAGES[p]();
  const m = /^\/learn\/track\/([^/]+)(\/library)?$/.exec(p);
  if (m) return m[2] ? TrackLibraryPage({ params: Promise.resolve({ slug: m[1] }) }) : TrackPage({ params: Promise.resolve({ slug: m[1] }) });
  const c = /^\/learn\/capstone\/([^/]+)$/.exec(p);
  if (c) return CapstonePage({ params: Promise.resolve({ courseId: c[1] }) } as Parameters<typeof CapstonePage>[0]);
  const l = /^\/learn\/([0-9a-f-]{36})$/.exec(p);
  if (l) return LessonPage({ params: Promise.resolve({ id: l[1] }) } as Parameters<typeof LessonPage>[0]);
  return <main className="ui-main-wide"><header className="ui-page-head"><h1>Stand-in</h1></header><p className="muted">Stand-in page for the shell test.</p></main>;
}

void pageFor(path).then((page) => createRoot(document.getElementById("root")!).render(
  <>
    <IconDefs />
    <Backdrop />
    <CursorFx />
    <GlassLens />
    <Spotlight />
    <UiSoundClicks />
    <AppHud />
    {page}
  </>,
));
