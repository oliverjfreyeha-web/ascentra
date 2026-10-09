import { SignInFlow } from "./sign-in-flow";
import { SiteFooter } from "../ui/site-footer";
import { SignedInGate } from "../signed-in-gate";

export default function SignInPage() {
  return (
    <main>
      <div className="ui-auth">
        <div className="ui-auth__halo" aria-hidden="true" />
        <div className="ui-auth__card">
          <SignedInGate kind="signin">
            <h1>Sign in to ASCENTRA</h1>
            <SignInFlow />
          </SignedInGate>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
