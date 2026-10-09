import { notFound } from "next/navigation";
import Link from "next/link";
import { phaseQueryAllowed } from "../../landing/hall/cycle";
import { CourseUiShowcase } from "./showcase";

export const metadata = { title: "Course UI (preview) · ASCENTRA", robots: { index: false, follow: false } };

/** D5 · A preview-only showcase of the course UI components. Not reachable on the production site. */
export default function CourseUiPage() {
  // Same rule as the Hall's ?phase= review switch: dev servers and Vercel previews only.
  if (!phaseQueryAllowed(process.env.NODE_ENV, process.env.VERCEL_ENV)) notFound();
  return (
    <main className="ui-main-wide">
      <nav className="ui-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link></nav>
      <header className="ui-page-head"><h1>Course UI (preview)</h1></header>
      <p className="muted">Example data only. These solid pieces carry progress, charts, video and text entry; they never sit on glass.</p>
      <CourseUiShowcase />
    </main>
  );
}
