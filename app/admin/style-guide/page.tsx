import type { Metadata } from "next";
import Link from "next/link";
import { StyleGuide } from "./style-guide";

export const metadata: Metadata = { title: "Style guide · ASCENTRA" };

/** D1 · Every token and base component on one page, with sample data only. For the Owner and Super Admins. */
export default function StyleGuidePage() {
  return (
    <main className="wide">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin/audit">Audit log</Link></p>
      <StyleGuide />
    </main>
  );
}
