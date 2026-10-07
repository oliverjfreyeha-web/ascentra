"use client";

import Link from "next/link";

/** D3 · A calm error page in the house style, for an error inside a page (the layout and the sound keep running). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <div className="ui-auth ui-state-page">
        <div className="ui-auth__halo" aria-hidden="true" />
        <div className="ui-auth__card" role="alert">
          <p className="ui-label">Something went wrong</p>
          <h1>This page couldn&apos;t load.</h1>
          <p className="muted">Try again in a moment. If it keeps happening, go back to Home.</p>
          <p className="ui-actions">
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => reset()}>Try again</button>
            <Link href="/" className="ui-btn">Go to Home</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
