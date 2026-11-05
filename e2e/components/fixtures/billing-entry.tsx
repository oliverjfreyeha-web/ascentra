/** Mounts Account → Billing alone for e2e/components/plan-includes.spec.ts. Clerk and next/link are stood in for. */
import { createRoot } from "react-dom/client";
import { BillingPanel } from "../../../app/account/billing-panel";

createRoot(document.getElementById("root")!).render(<main className="ui-main-wide"><h1>Account and devices</h1><BillingPanel /></main>);
