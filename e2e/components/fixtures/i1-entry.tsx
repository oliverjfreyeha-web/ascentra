/**
 * I1: mounts the Import course page, the admin home's links, the main navigation's account line and the topics admin
 * for the component tests (e2e/components/course-import.spec.ts). Clerk, the Next router and next/link are stood in for;
 * the API is answered by the test with the real routes' shapes.
 */
import { createRoot } from "react-dom/client";
import { ImportPage } from "../../../app/admin/import/import-page";
import ImportCoursePage from "../../../app/admin/import/page";
import TopicsPage from "../../../app/admin/topics/page";
import { AdminLinks } from "../../../app/admin/admin-home";
import { AccountPanel } from "../../../app/account-panel";

const view = (window as unknown as { __view: string }).__view;
const VIEWS: Record<string, () => React.ReactNode> = {
  import: () => <ImportCoursePage />,
  importOnly: () => <main className="wide ui-admin"><h1>Import course</h1><ImportPage /></main>,
  topics: () => <TopicsPage />,
  adminHome: () => <main className="ui-admin"><h1>Administrators</h1><AdminLinks /></main>,
  home: () => <main className="ui-main-wide"><h1>Home</h1><AccountPanel /></main>,
};
createRoot(document.getElementById("root")!).render(VIEWS[view]());
