// Stand-ins used only by the C2 component tests' bundle: Clerk (signed in; reverification passes the call through),
// Next's router and search params, and next/link as a plain link.
import type { AnchorHTMLAttributes } from "react";
export const useReverification = <T,>(fn: T) => fn;
export const useAuth = () => ({ isLoaded: true, isSignedIn: true });
export const useClerk = () => ({ signOut: async () => undefined });
export const SignOutButton = ({ children }: { children?: unknown }) => children ?? null;
export const useRouter = () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined });
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => window.location.pathname;
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
