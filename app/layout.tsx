import type { Metadata } from "next";
import { preload } from "react-dom";
import { ClerkProvider } from "@clerk/nextjs";
import { BillingBanner } from "./billing-banner";
import { StaffNav } from "./staff-nav";
import { DeviceGate } from "./device-gate";
import { clerkAppearance } from "./clerk-appearance";
import { fontVariables } from "./fonts";
import { Spotlight } from "./ui/spotlight";
import { EnvRoot } from "./env/env-root";
import { prefsBootScript } from "./env/prefs";
import { GlassLens } from "./ui/glass-lens";
import { SoundProvider } from "./ui/sound/sound-provider";
import { IconDefs } from "./ui/design/ds-icon";
import { UiSoundClicks } from "./ui/sound/ui-sound-clicks";
import "./styles/tokens.css";
import "./styles/components.css";
import "./globals.css";
import "./styles/polish.css";
import "./styles/glass.css";
import "./styles/design.css";
import "./styles/primitives.css";

export const metadata: Metadata = {
  title: "ASCENTRA",
  description: "ASCENTRA · Foundations in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Design rebuild D1: the Ascentra font (headings, big numbers, small-caps labels) starts loading with the page.
  preload("/fonts/AscentraSemi.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en" className={fontVariables} suppressHydrationWarning>
        <body>
          {/* D5 + D1 rebuild: the saved scene, glass, motion and theme (and data-reduced), applied before first paint (raw markup, so React never renders a <script>). */}
          <div hidden dangerouslySetInnerHTML={{ __html: `<script>${prefsBootScript()}</script>` }} />
          <IconDefs />
          <EnvRoot />
          <GlassLens />
          <Spotlight />
          <UiSoundClicks />
          {/* D2e: the ambient player lives here, outside every page and route segment, so navigation never stops it. */}
          <SoundProvider>
            <BillingBanner />
            <StaffNav />
            <DeviceGate>{children}</DeviceGate>
          </SoundProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
