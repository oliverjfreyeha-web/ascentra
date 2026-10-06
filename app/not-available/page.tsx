import Link from "next/link";

// Shown after the sign-up step refuses an account. Deliberately no way back to the date-of-birth step.
export default function NotAvailablePage() {
  return (
    <main>
      <div className="ui-auth">
        <div className="ui-auth__card">
          <h1>We can&apos;t create an account</h1>
          <p>ASCENTRA isn&apos;t available for this account. Nothing you entered was saved.</p>
          <p>
            <Link href="/">Return home</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
