import { AccountPanel } from "./account-panel";
import { ServiceStatus } from "./service-status";

export default function Home() {
  return (
    <main className="wide">
      <header className="ui-hero">
        <div className="ui-scene" aria-hidden="true">
          <div className="ui-scene__grid" />
          <div className="ui-scene__glow" />
          <div className="ui-scene__orb" />
        </div>
        <h1>ASCENTRA · Foundations in progress</h1>
        <div className="ui-hero__lede">
          <AccountPanel />
        </div>
      </header>
      <div className="ui-block home-status">
        <ServiceStatus />
      </div>
    </main>
  );
}
