// Builds db/apply/<name>.sql from db/migrations, per db/apply/bundles.json: the listed migrations
// in order, inside one transaction. Any error rolls back everything, and each migration refuses to
// run twice (private.begin_migration), so pasting the file a second time changes nothing.
//   node scripts/bundle-migrations.mjs          write the bundles
//   node scripts/bundle-migrations.mjs --check  fail if a bundle is out of date
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../db/", import.meta.url);
const { bundles } = JSON.parse(readFileSync(new URL("apply/bundles.json", root), "utf8"));
const check = process.argv.includes("--check");

export function buildBundle(name, { requires, migrations }) {
  const parts = migrations.map((m) => {
    const sql = readFileSync(new URL(`migrations/${m}.sql`, root), "utf8").trimEnd();
    return `-- ============================================================\n-- ${m}.sql\n-- ============================================================\n\n${sql}\n`;
  });
  return [
    `-- ASCENTRA ${name}: paste this whole file into the Supabase SQL Editor and click Run, once.`,
    `-- Requires ${requires} (already applied). Applies: ${migrations.join(", ")}.`,
    `-- Runs in one transaction: if anything fails, nothing is changed.`,
    `-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.`,
    ``,
    `begin;`,
    ``,
    ...parts,
    `commit;`,
    ``,
  ].join("\n");
}

let stale = 0;
for (const [name, spec] of Object.entries(bundles)) {
  const path = new URL(`apply/${name}.sql`, root);
  const want = buildBundle(name, spec);
  if (check) {
    let have = "";
    try {
      have = readFileSync(path, "utf8");
    } catch {}
    if (have !== want) {
      console.error(`db/apply/${name}.sql is out of date. Run: npm run db:bundle`);
      stale++;
    }
  } else {
    writeFileSync(path, want);
    console.log(`Wrote db/apply/${name}.sql (${spec.migrations.length} migrations)`);
  }
}
process.exit(stale ? 1 : 0);
