// Searches everything under .next (server output, client bundle and .next/cache) for secret values.
// Run after a build, with the same secret values in this process's environment that the build was given.
//
// Build caches are compressed, which can split a value, so this looks for every 10-character
// window of each value rather than only the whole value. Any window found counts as a leak.
// Pass --expect-present to run the positive control (a build that did see the secrets must fail this).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const { names } = JSON.parse(readFileSync(new URL("../lib/secret-env-names.json", import.meta.url), "utf8"));
const expectPresent = process.argv.includes("--expect-present");
const WINDOW = 10;

const secrets = names.map((n) => [n, process.env[n]]).filter(([, v]) => v);
if (secrets.length !== names.length) {
  console.error(`Set every secret before running: ${names.join(", ")}`);
  process.exit(2);
}
for (const [n, v] of secrets) {
  if (v.length < 24) {
    console.error(`${n} is too short to search for reliably (use 24+ random characters).`);
    process.exit(2);
  }
}

const chunks = [];
let files = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      chunks.push(readFileSync(p));
      files++;
    }
  }
})(".next");
const data = Buffer.concat(chunks);

let leaks = 0;
for (const [name, value] of secrets) {
  const v = Buffer.from(value);
  let found = 0;
  const total = v.length - WINDOW + 1;
  for (let i = 0; i < total; i++) if (data.includes(v.subarray(i, i + WINDOW))) found++;
  console.log(`${name}: ${found}/${total} fragments found`);
  if (found) leaks++;
}
console.log(`Searched ${files} files (${(data.length / 1e6).toFixed(1)} MB) under .next, including .next/cache.`);

if (expectPresent) {
  if (leaks === secrets.length) console.log("Positive control: every secret was found, so the search works.");
  else {
    console.error("Positive control failed: the search did not find secrets that were present.");
    process.exit(1);
  }
} else if (leaks) {
  console.error("Secret values found in the build output or cache.");
  process.exit(1);
} else console.log("No secret value found in the build output or cache.");
