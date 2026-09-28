// Checks the shape of the secrets a workflow needs, without ever printing a value.
//   node e2e/check-secrets.mjs CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ...
// Each failure names the secret and what's wrong (empty, a non-plain character and where, wrong start).
const RULES = {
  CLERK_SECRET_KEY: { re: /^sk_(test|live)_[A-Za-z0-9]+$/, want: "a Clerk secret key: sk_test_ followed by letters and digits" },
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { secret: "CLERK_PUBLISHABLE_KEY", re: /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/, want: "a Clerk publishable key: pk_test_…" },
  OWNER_EMAIL: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, want: "just the Owner's email address" },
  SUPABASE_URL: { re: /^https:\/\/[A-Za-z0-9.-]+(\/.*)?$/, want: "https://<project>.supabase.co" },
  SUPABASE_ANON_KEY: { re: /^(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)$/, want: "the anon key (eyJ…) or publishable key (sb_publishable_…)" },
  SUPABASE_SERVICE_ROLE_KEY: { re: /^(eyJ[A-Za-z0-9._-]+|sb_secret_[A-Za-z0-9_-]+)$/, want: "the service_role key (eyJ…) or secret key (sb_secret_…)" },
};

let bad = 0;
for (const name of process.argv.slice(2)) {
  const rule = RULES[name];
  const label = rule?.secret ?? name;
  const v = process.env[name] ?? "";
  const fail = (why) => {
    console.log(`::error title=Secret ${label}::${label} ${why}. It should be ${rule?.want ?? "set"}. Update it under Settings → Secrets and variables → Actions.`);
    bad++;
  };
  if (!v) { fail("is empty or missing"); continue; }
  if (v !== v.trim()) { fail("starts or ends with a space or line break"); continue; }
  const odd = [...v].findIndex((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e);
  if (odd >= 0) { fail(`has a character that isn't plain text at position ${odd + 1} (was a label or arrow pasted with it?)`); continue; }
  if (rule && !rule.re.test(v)) { fail("doesn't have the expected shape"); continue; }
  if (name === "SUPABASE_URL" && new URL(v).pathname !== "/") {
    console.log(`::warning title=Secret SUPABASE_URL::SUPABASE_URL has a path after the host; the smoke uses only https://<host>. Consider saving just https://<project>.supabase.co.`);
  }
  console.log(`${label}: looks right`);
}
process.exit(bad ? 1 : 0);
