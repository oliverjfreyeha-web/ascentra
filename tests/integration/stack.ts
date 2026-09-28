/**
 * A local stand-in for Supabase's Data API: a fresh Postgres database with every migration, PostgREST
 * in front of it, and a tiny proxy that serves it under /rest/v1 like Supabase does. The app's own
 * Supabase client (lib/db) talks to it unchanged, so route tests exercise real SQL: RLS, grants,
 * triggers, check constraints and the security definer functions.
 *
 * Needs TEST_DATABASE_URL (a Postgres server it may create databases on) and POSTGREST_BIN (the
 * PostgREST executable). CI downloads PostgREST; see .github/workflows/ci.yml.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createTestDb, type TestDb } from "../db/helpers";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** An HS256 JWT, as Supabase issues its API keys and as PostgREST verifies them. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), ...claims }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export type Stack = {
  db: TestDb;
  /** Base URL, like https://<project>.supabase.co. */
  url: string;
  jwtSecret: string;
  serviceKey: string;
  anonKey: string;
  stop: () => Promise<void>;
};

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export async function startStack(): Promise<Stack> {
  const bin = process.env.POSTGREST_BIN;
  if (!bin) throw new Error("POSTGREST_BIN is not set (path to the PostgREST executable).");
  const db = await createTestDb();
  const jwtSecret = randomBytes(32).toString("hex");
  const password = randomBytes(12).toString("hex");

  // PostgREST's login role, allowed to switch into the three API roles (as on Supabase).
  await db.client.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticator') then
      create role authenticator login noinherit;
    end if; end $$;`);
  await db.client.query(`alter role authenticator with login password '${password}'`);
  await db.client.query("grant anon, authenticated, service_role to authenticator");

  const dbUrl = new URL(db.url);
  dbUrl.username = "authenticator";
  dbUrl.password = password;
  const pgrstPort = await freePort();
  const proc: ChildProcess = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUrl.toString(),
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(pgrstPort),
      PGRST_LOG_LEVEL: "error",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d) => (stderr += String(d)));

  // /rest/v1/<path> → PostgREST /<path>
  const proxy: Server = createServer((req, res) => {
    const path = (req.url ?? "/").replace(/^\/rest\/v1/, "") || "/";
    const up = httpRequest({ host: "127.0.0.1", port: pgrstPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${pgrstPort}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(up);
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  // Wait until PostgREST has loaded its schema cache.
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/rest/v1/`, { headers: { Authorization: `Bearer ${signJwt({ role: "service_role" }, jwtSecret)}` } });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`PostgREST didn't start: ${stderr}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    db, url, jwtSecret,
    serviceKey: signJwt({ role: "service_role", iss: "supabase" }, jwtSecret),
    anonKey: signJwt({ role: "anon", iss: "supabase" }, jwtSecret),
    stop: async () => {
      proc.kill();
      await new Promise<void>((r) => proxy.close(() => r()));
      await db.drop();
    },
  };
}

export { pg };
