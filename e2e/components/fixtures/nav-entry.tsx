/**
 * Bug stage (Owner nav): mounts the real home page, Account page and admin home under the root layout's staff
 * navigation, as the layout does, for e2e/components/owner-nav.spec.ts. Clerk, the Next router and next/link are
 * stood in for; the API is answered by the test.
 */
import { createRoot } from "react-dom/client";
import Home from "../../../app/page";
import AccountPage from "../../../app/account/page";
import AdminPage from "../../../app/admin/page";
import { StaffNav } from "../../../app/staff-nav";

const view = (window as unknown as { __view: string }).__view;
const VIEWS: Record<string, () => React.ReactNode> = {
  home: () => <Home />,
  account: () => <AccountPage />,
  admin: () => <AdminPage />,
};
createRoot(document.getElementById("root")!).render(<><StaffNav />{VIEWS[view]()}</>);
