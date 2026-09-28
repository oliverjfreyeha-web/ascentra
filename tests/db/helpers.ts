import { readdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) {
  throw new Error(
    "TEST_DATABASE_URL is not set. The database tests need a Postgres server they may create and drop databases on, " +
      "e.g. postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  );
}

export const MIGRATIONS_DIR = "db/migrations";
export const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

export const readSql = (path: string) => readFileSync(path, "utf8");

/** The 39 prototype entities (reference/ascentra.html, DATA_MODEL) as tables. */
export const EXPECTED_TABLES = [
  "accounts", "profiles", "role_assignments", "guardian_relationships", "trusted_devices", "session_events",
  "subscriptions", "trial_consents", "entitlements", "academies", "courses", "academy_blueprints", "modules",
  "lessons", "skills", "sources", "source_claims", "source_conflicts", "authority_decisions",
  "learning_activities", "assessment_attempts", "assignments", "projects", "capstones", "review_items",
  "schedules", "progress_records", "mastery_records", "retention_signals", "mentor_threads", "notes", "uploads",
  "world_preferences", "notification_preferences", "legal_document_versions", "consent_records",
  "safety_events", "audit_events", "connection_statuses",
].sort();

export type TestDb = { client: pg.Client; url: string; drop: () => Promise<void> };

/** A new, empty database with the Supabase shim, and optionally migrations applied in order. */
export async function createTestDb({ migrate = true }: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `ascentra_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(URL_!);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(readSql("db/test/supabase-shim.sql"));
  if (migrate) for (const f of migrationFiles()) await client.query(readSql(`${MIGRATIONS_DIR}/${f}`));

  return {
    client,
    url: url.toString(),
    drop: async () => {
      await client.end();
      const a = new pg.Client({ connectionString: URL_ });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export type Outcome = { rows: Record<string, unknown>[]; error?: undefined } | { rows?: undefined; error: string };

/**
 * Runs one statement the way the Supabase Data API would for a request: as the given API role,
 * with the request's JWT claims set. Always rolled back.
 */
export async function asRole(
  client: pg.Client,
  role: "anon" | "authenticated" | "service_role" | "owner",
  claims: Record<string, unknown> | null,
  sql: string,
  params: unknown[] = [],
): Promise<Outcome> {
  await client.query("begin");
  try {
    if (role !== "owner") await client.query(`set local role ${role}`);
    if (claims) await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await client.query(sql, params);
    return { rows: res.rows };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    await client.query("rollback");
  }
}

/** A Clerk session token's claims, as Supabase third-party auth receives them. */
export const clerkClaims = (clerkUserId: string) => ({ sub: clerkUserId, role: "authenticated" });
