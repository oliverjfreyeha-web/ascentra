import { WelcomeFlow } from "./welcome-flow";

export default function WelcomePage() {
  return (
    <main className="ds-page ds-page--calm">
      <div className="ui-auth ui-auth--wide">
        <div className="ui-auth__halo" aria-hidden="true" />
        <div className="ui-auth__card">
          <WelcomeFlow />
        </div>
      </div>
    </main>
  );
}
