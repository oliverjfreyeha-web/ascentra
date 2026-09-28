// One-time: sends the Clerk invitation for OWNER_EMAIL. Sign-up is Restricted, so the Owner
// can only create a Clerk user through an invitation. Safe to re-run: Clerk won't invite twice.
//
//   node --env-file=.env.local scripts/invite-owner.mjs
//
// The Owner's Account row is created by the webhook when that user signs up with a verified email.
const { CLERK_SECRET_KEY, OWNER_EMAIL } = process.env;
if (!CLERK_SECRET_KEY || !OWNER_EMAIL) {
  console.error("Set CLERK_SECRET_KEY and OWNER_EMAIL (for example in .env.local).");
  process.exit(2);
}

const res = await fetch("https://api.clerk.com/v1/invitations", {
  method: "POST",
  headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email_address: OWNER_EMAIL, notify: true, ignore_existing: true }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Clerk refused the invitation (${res.status}):`, body.errors?.map((e) => e.long_message ?? e.message).join("; "));
  process.exit(1);
}
console.log(`Invitation ${body.status ?? "created"} for ${OWNER_EMAIL}.`);
