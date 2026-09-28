// A small in-memory stand-in for the parts of the Supabase client lib/ uses:
// from(t).select/insert/update/upsert/delete, .eq/.in/.order, .single/.maybeSingle, head counts,
// and .select() after a write. It mimics the unique rules the real schema enforces for
// accounts (one Owner) and role_assignments (one open invite per email, one live role per account).
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Err = { code: string; message: string } | null;

export function createFakeDb(tables: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = { accounts: [], profiles: [], role_assignments: [], audit_events: [], ...tables };

  function violates(table: string, candidate: Row, self?: Row): Err {
    const others = (data[table] ?? []).filter((r) => r !== self);
    const dup = (msg: string) => ({ code: "23505", message: msg });
    if (table === "accounts") {
      if (candidate.role === "owner" && others.some((r) => r.role === "owner")) return dup("accounts_single_owner");
      if (others.some((r) => r.clerk_user_id === candidate.clerk_user_id)) return dup("accounts_clerk_user_id_key");
    }
    if (table === "role_assignments") {
      const open = (r: Row) => r.status === "invited" || r.status === "claimed";
      const live = (r: Row) => r.status === "claimed" || r.status === "active";
      if (open(candidate) && others.some((r) => open(r) && r.invited_email === candidate.invited_email)) {
        return dup("role_assignments_one_open_invite_per_email");
      }
      if (candidate.account_id && live(candidate) && others.some((r) => live(r) && r.account_id === candidate.account_id)) {
        return dup("role_assignments_one_live_per_account");
      }
    }
    return null;
  }

  function query(table: string) {
    const rows = () => (data[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let head = false;
    let returning = false;
    let payload: Row = {};
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    const like = (v: unknown, pattern: string) =>
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(v ?? ""));

    const run = (): { data: unknown; error: Err; count?: number } => {
      const match = (r: Row) => filters.every((f) => f(r));
      if (op === "insert") {
        const row: Row = { id: randomUUID(), status: table === "accounts" ? "active" : undefined, ...payload };
        // audit_events: the database numbers rows (0006's chain trigger); mirror the numbering here.
        if (table === "audit_events") Object.assign(row, { seq: rows().length + 1, occurred_at: new Date().toISOString(), row_hash: `hash${rows().length + 1}` });
        const err = violates(table, row);
        if (err) return { data: null, error: err };
        rows().push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        const hit = rows().filter(match);
        for (const r of hit) {
          const err = violates(table, { ...r, ...payload }, r);
          if (err) return { data: null, error: err };
        }
        hit.forEach((r) => Object.assign(r, payload));
        return { data: returning ? hit : null, error: null };
      }
      if (op === "delete") {
        const keep = rows().filter((r) => !match(r));
        data[table] = keep;
        return { data: null, error: null };
      }
      let hit = rows().filter(match);
      if (orderBy) hit = [...hit].sort((a, b) => ((a[orderBy!.col] as number) - (b[orderBy!.col] as number)) * (orderBy!.asc ? 1 : -1));
      if (limitN != null) hit = hit.slice(0, limitN);
      return head ? { data: null, error: null, count: hit.length } : { data: hit, error: null };
    };

    const q = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (op === "select") head = !!opts?.head;
        else returning = true;
        return q;
      },
      eq(k: string, v: unknown) {
        filters.push((r) => r[k] === v);
        return q;
      },
      in(k: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[k]));
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, asc: opts?.ascending ?? true };
        return q;
      },
      limit(n: number) {
        limitN = n;
        return q;
      },
      ilike(k: string, pattern: string) {
        filters.push((r) => like(r[k], pattern));
        return q;
      },
      /** Only the form lib/audit uses: "a.ilike.%x%,b.ilike.%x%". */
      or(expr: string) {
        const parts = expr.split(",").map((p) => p.split(".ilike."));
        filters.push((r) => parts.some(([k, pat]) => like(r[k], pat)));
        return q;
      },
      gte(k: string, v: unknown) {
        filters.push((r) => String(r[k]) >= String(v));
        return q;
      },
      lte(k: string, v: unknown) {
        filters.push((r) => String(r[k]) <= String(v));
        return q;
      },
      lt(k: string, v: number) {
        filters.push((r) => (r[k] as number) < v);
        return q;
      },
      insert(row: Row) {
        op = "insert";
        payload = row;
        return q;
      },
      update(p: Row) {
        op = "update";
        payload = p;
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      async upsert(row: Row) {
        const i = rows().findIndex((r) => r.account_id === row.account_id);
        if (i >= 0) rows()[i] = { ...rows()[i], ...row };
        else rows().push({ id: randomUUID(), ...row });
        return { error: null };
      },
      async maybeSingle() {
        const r = run();
        const list = (r.data as Row[] | null) ?? [];
        return { data: list[0] ?? null, error: r.error };
      },
      async single() {
        const r = run();
        const list = (r.data as Row[] | null) ?? [];
        return r.error ? { data: null, error: r.error } : { data: list[0] ?? null, error: list[0] ? null : { code: "PGRST116", message: "no rows" } };
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(run());
        } catch (e) {
          reject?.(e);
        }
      },
    };
    return q;
  }

  const rpc = async (fn: string) =>
    fn === "audit_verify_chain"
      ? { data: [{ ok: true, checked: data.audit_events.length, broken_at_seq: null, problem: null, head_seq: data.audit_events.length || null, head_hash: data.audit_events.at(-1)?.row_hash ?? null }], error: null }
      : { data: null, error: { code: "42883", message: `no function ${fn}` } };

  return { data, client: { from: query, rpc } };
}
