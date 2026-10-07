import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { BillingBanner } from "./billing-banner";
import { DeviceGate } from "./device-gate";
import { clerkAppearance } from "./clerk-appearance";
import { fontVariables } from "./fonts";
import { Spotlight } from "./ui/spotlight";
import "./styles/tokens.css";
import "./styles/components.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCENTRA",
  description: "ASCENTRA · Foundations in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en" className={fontVariables}>
        <body>
          <Spotlight />
          <BillingBanner />
          <DeviceGate>{children}</DeviceGate>
        </body>
      </html>
    </ClerkProvider>
  );
}
