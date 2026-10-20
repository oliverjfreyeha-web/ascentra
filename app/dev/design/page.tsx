import { notFound } from "next/navigation";
import { phaseQueryAllowed } from "../../landing/hall/cycle";
import { DesignPreview } from "./preview";
import "./preview.css";

export const metadata = { title: "Design system (preview) · ASCENTRA", robots: { index: false, follow: false } };

/**
 * Design rebuild D1 · The design foundations on one page: tokens, type scale, icons, and both themes side by side.
 * For checking later stages by eye. Not linked from the product, and not reachable on the production site (same rule
 * as /dev/course-ui: dev servers and Vercel previews only).
 */
export default function DesignPage() {
  if (!phaseQueryAllowed(process.env.NODE_ENV, process.env.VERCEL_ENV)) notFound();
  return <DesignPreview />;
}
