/**
 * R1: Create account (and Sign in) while already signed in used to redirect silently into the existing account. Now
 * the page says who is signed in, with "Go to my account" and "Sign out to create a different account". Clerk's form
 * never mounts for someone already signed in (so it can't redirect first); someone who signs in on the page itself is
 * let through to Clerk's own redirect; and the server and the first browser render match (no hydration error).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "sam@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

import { AlreadySignedIn, SignedInGate, gateView } from "@/app/signed-in-gate";

describe("Create account / Sign in while signed in", () => {
  it("signed in when the page opened: the notice, never Clerk's form", () => {
    expect(gateView({ mounted: true, isLoaded: true, isSignedIn: true, sawSignedOut: false })).toBe("notice");
  });
  it("signed out, Clerk still loading, or just signed in on this page: the form", () => {
    expect(gateView({ mounted: true, isLoaded: true, isSignedIn: false, sawSignedOut: true })).toBe("form");
    expect(gateView({ mounted: true, isLoaded: false, isSignedIn: false, sawSignedOut: false })).toBe("form");
    expect(gateView({ mounted: true, isLoaded: true, isSignedIn: true, sawSignedOut: true })).toBe("form");
  });
  it("renders nothing on the server, so the browser's first render matches it", () => {
    expect(gateView({ mounted: false, isLoaded: true, isSignedIn: true, sawSignedOut: false })).toBe("wait");
    expect(renderToStaticMarkup(<SignedInGate kind="create"><div id="clerk-form" /></SignedInGate>)).toBe("");
  });
  it("the notice says who, with Go to my account and Sign out to create a different account", () => {
    const html = renderToStaticMarkup(<AlreadySignedIn kind="create" />);
    expect(html).toContain("You&#x27;re already signed in as sam@example.com.");
    expect(html).toContain('href="/account"');
    expect(html).toContain("Go to my account");
    expect(html).toContain("Sign out to create a different account");
    expect(renderToStaticMarkup(<AlreadySignedIn kind="signin" />)).toContain("Sign out to use a different account");
  });
});
