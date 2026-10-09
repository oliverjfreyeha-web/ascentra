// Stand-ins used only by the component tests' bundle: Clerk's reverification hook passes the call straight through,
// and next/link is a plain link.
import type { AnchorHTMLAttributes } from "react";
export const useReverification = <T,>(fn: T) => fn;
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
