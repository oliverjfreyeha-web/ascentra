import { UserProfile } from "@clerk/nextjs";

// Passkeys, password and second factor are managed by Clerk. ASCENTRA stores none of them.
export default function AccountPage() {
  return (
    <main>
      <h1>Account security</h1>
      <UserProfile routing="hash" />
    </main>
  );
}
