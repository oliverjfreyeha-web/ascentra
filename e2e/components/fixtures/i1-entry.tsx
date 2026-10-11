/**
 * I1: mounts the Import course page, the admin home's links, the main navigation's account line and the topics admin
 * for the component tests (e2e/components/course-import.spec.ts). Clerk, the Next router and next/link are stood in for;
 * the API is answered by the test with the real routes' shapes.
 */
import { createRoot } from "react-dom/client";
import Link from "next/link";
import { ImportPage } from "../../../app/admin/import/import-page";
import ImportCoursePage from "../../../app/admin/import/page";
import TopicsPage from "../../../app/admin/topics/page";
import { AdminLinks } from "../../../app/admin/admin-home";
import { AccountPanel } from "../../../app/account-panel";
import { StaffNav } from "../../../app/staff-nav";

const view = (window as unknown as { __view: string }).__view;
const VIEWS: Record<string, () => React.ReactNode> = {
  import: () => <ImportCoursePage />,
  importOnly: () => <main className="wide ui-admin"><h1>Import course</h1><ImportPage /></main>,
  topics: () => <TopicsPage />,
  adminHome: () => <main className="ui-admin"><h1>Administrators</h1><AdminLinks /></main>,
  // S1: the root layout renders the staff navigation above every page.
  home: () => <><StaffNav /><main className="ui-main-wide"><h1>Home</h1><AccountPanel /></main></>,
  account: () => <><StaffNav /><main className="ui-main-wide"><nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> · <button type="button" className="link">Sign out</button></nav><h1>Account</h1></main></>,
};
createRoot(document.getElementById("root")!).render(VIEWS[view]());
