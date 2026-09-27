import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCENTRA",
  description: "ASCENTRA · Foundations in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
