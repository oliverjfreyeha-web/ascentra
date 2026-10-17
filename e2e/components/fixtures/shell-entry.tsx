/**
 * Design rebuild D3: the root layout's page-wide pieces (icon gradients, backdrop, cursor effects, pointer listener,
 * lens, sounds, HUD) around a real page chosen by the URL path, for e2e/components/design-shell.spec.ts and the D3
 * screenshots. Clerk, the Next router and next/link are stood in for; the API is answered by the test.
 */
import { createRoot } from "react-dom/client";
import Home from "../../../app/page";
import AccountPage from "../../../app/account/page";
import LearnPage from "../../../app/learn/page";
import { IconDefs } from "../../../app/ui/design/ds-icon";
import { Backdrop } from "../../../app/ui/backdrop/backdrop";
import { CursorFx } from "../../../app/ui/shell/cursor-fx";
import { AppHud } from "../../../app/ui/shell/app-hud";
import { Spotlight } from "../../../app/ui/spotlight";
import { GlassLens } from "../../../app/ui/glass-lens";
import { UiSoundClicks } from "../../../app/ui/sound/ui-sound-clicks";

const path = window.location.pathname;
const page = path === "/" ? <Home />
  : path === "/account" ? <AccountPage />
  : path === "/learn" ? <LearnPage />
  : <main className="ui-main-wide"><header className="ui-page-head"><h1>{path === "/guardian" ? "Guardian Center" : "Sign in"}</h1></header><p className="muted">Stand-in page for the shell test.</p></main>;

createRoot(document.getElementById("root")!).render(
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
);
