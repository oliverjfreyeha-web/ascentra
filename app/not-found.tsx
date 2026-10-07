import Link from "next/link";

/** D3 · A friendly 404 in the house style. */
export default function NotFound() {
  return (
    <main>
      <div className="ui-auth ui-state-page">
        <div className="ui-auth__halo" aria-hidden="true" />
        <div className="ui-auth__card">
          <p className="ui-label"><span className="ui-num">404</span> / Not found</p>
          <h1>This page isn&apos;t here.</h1>
          <p className="muted">The link may be old, or the page may have moved.</p>
          <p className="ui-actions">
            <Link href="/" className="ui-btn ui-btn--primary">Go to Home</Link>
            <Link href="/learn" className="ui-btn">My learning</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
