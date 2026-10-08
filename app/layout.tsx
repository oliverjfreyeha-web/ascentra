import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { BillingBanner } from "./billing-banner";
import { DeviceGate } from "./device-gate";
import { clerkAppearance } from "./clerk-appearance";
import { fontVariables } from "./fonts";
import { Spotlight } from "./ui/spotlight";
import { EnvRoot } from "./env/env-root";
import { prefsBootScript } from "./env/prefs";
import { GlassLens } from "./ui/glass-lens";
import { SoundProvider } from "./ui/sound/sound-provider";
import "./styles/tokens.css";
import "./styles/components.css";
import "./globals.css";
import "./styles/polish.css";
import "./styles/glass.css";

export const metadata: Metadata = {
  title: "ASCENTRA",
  description: "ASCENTRA · Foundations in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en" className={fontVariables} suppressHydrationWarning>
        <body>
          {/* D5: the saved scene, glass and motion, applied before first paint (raw markup, so React never renders a <script>). */}
          <div hidden dangerouslySetInnerHTML={{ __html: `<script>${prefsBootScript()}</script>` }} />
          <EnvRoot />
          <GlassLens />
          <Spotlight />
          {/* D2e: the ambient player lives here, outside every page and route segment, so navigation never stops it. */}
          <SoundProvider>
            <BillingBanner />
            <DeviceGate>{children}</DeviceGate>
          </SoundProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
