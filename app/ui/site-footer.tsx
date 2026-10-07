import Link from "next/link";
import { AmbientSound } from "./ambient-sound";

/** D2c: the footer on the signed-out and learner screens (not lessons): the opt-in ambient sound and the art credits. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <AmbientSound />
      <Link href="/credits" className="site-footer__link">Art and sound credits</Link>
    </footer>
  );
}
