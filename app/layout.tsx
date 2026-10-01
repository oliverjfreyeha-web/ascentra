import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { DeviceGate } from "./device-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCENTRA",
  description: "ASCENTRA · Foundations in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en">
        <body>
          <DeviceGate>{children}</DeviceGate>
        </body>
      </html>
    </ClerkProvider>
  );
}
