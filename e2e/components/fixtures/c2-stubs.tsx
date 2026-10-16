// Stand-ins used only by the C2 component tests' bundle: Clerk (signed in; reverification passes the call through),
// Next's router and search params, and next/link as a plain link.
import type { AnchorHTMLAttributes } from "react";
export const useReverification = <T,>(fn: T) => fn;
// A test may set window.__clerkSignedIn = false to stand in for Clerk's browser state lagging behind the server's.
// getToken counts its calls (window.__tokens) so a test can see the session token was refreshed before asking the API.
type W = { __clerkSignedIn?: boolean; __tokens?: number };
const getToken = async () => { const w = window as unknown as W; w.__tokens = (w.__tokens ?? 0) + 1; return "test-token"; };
export const useAuth = () => ({ isLoaded: true, isSignedIn: (window as unknown as W).__clerkSignedIn ?? true, getToken });
export const useClerk = () => ({ signOut: async () => undefined });
export const useUser = () => ({ isLoaded: true, user: { twoFactorEnabled: true } });
export const UserProfile = () => null;
export const SignOutButton = ({ children }: { children?: unknown }) => children ?? null;
export const useRouter = () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined });
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => window.location.pathname;
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
