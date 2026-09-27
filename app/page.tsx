import { AccountPanel } from "./account-panel";
import { ServiceStatus } from "./service-status";

export default function Home() {
  return (
    <main>
      <h1>ASCENTRA · Foundations in progress</h1>
      <AccountPanel />
      <ServiceStatus />
    </main>
  );
}
