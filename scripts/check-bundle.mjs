// Searches the built client bundle (.next/static) for server secrets.
// Run after `next build`. Checks the variable names, known secret-key shapes, and,
// when set in this process's environment, the actual secret values.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

const needles = [
  { what: "name SUPABASE_SERVICE_ROLE_KEY", text: "SUPABASE_SERVICE_ROLE_KEY" },
  { what: "name CLERK_SECRET_KEY", text: "CLERK_SECRET_KEY" },
  { what: "Supabase secret key prefix", text: "sb_secret_" },
  { what: "Clerk secret key prefix", re: /sk_(live|test)_[A-Za-z0-9]/ },
  { what: "service_role JWT claim", text: "service_role" },
];
for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "CLERK_SECRET_KEY"]) {
  const v = process.env[name];
  if (v) needles.push({ what: `value of ${name}`, text: v });
}

const hits = [];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  for (const n of needles) if (n.re ? n.re.test(body) : body.includes(n.text)) hits.push(`${f}: ${n.what}`);
}

const valueChecks = needles.filter((n) => n.what.startsWith("value of")).length;
console.log(`Searched ${files.length} client files for ${needles.length} patterns (${valueChecks} secret values).`);
if (hits.length) {
  console.error("Secret material found in the client bundle:\n" + hits.map((h) => "  " + h).join("\n"));
  process.exit(1);
}
console.log("No service key found in the client bundle.");
