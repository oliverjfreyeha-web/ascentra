// A small in-memory stand-in for the parts of the Supabase client lib/accounts uses.
type Row = Record<string, unknown>;

export function createFakeDb(tables: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = { accounts: [], profiles: [], ...tables };
  let seq = 0;

  function query(table: string) {
    const rows = () => (data[table] ??= []);
    const filters: [string, unknown][] = [];
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    let op: "select" | "insert" | "update" = "select";
    let head = false;
    let patch: Row = {};
    let inserted: Row | null = null;
    let insertError: { code: string; message: string } | null = null;

    const q = {
      select(_cols?: string, opts?: { head?: boolean }) {
        head = !!opts?.head;
        return q;
      },
      eq(k: string, v: unknown) {
        filters.push([k, v]);
        return q;
      },
      insert(row: Row) {
        op = "insert";
        if (table === "accounts" && row.role === "owner" && rows().some((r) => r.role === "owner")) {
          insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
        } else {
          inserted = { id: `acc_${++seq}`, status: "active", ...row };
          rows().push(inserted);
        }
        return q;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return q;
      },
      async upsert(row: Row) {
        const i = rows().findIndex((r) => r.account_id === row.account_id);
        if (i >= 0) rows()[i] = { ...rows()[i], ...row };
        else rows().push(row);
        return { error: null };
      },
      async maybeSingle() {
        return { data: rows().find(match) ?? null, error: null };
      },
      async single() {
        return insertError ? { data: null, error: insertError } : { data: inserted, error: null };
      },
      then(resolve: (v: unknown) => void) {
        if (op === "update") {
          rows().filter(match).forEach((r) => Object.assign(r, patch));
          resolve({ error: null });
        } else if (head) resolve({ count: rows().filter(match).length, error: null });
        else resolve({ data: rows().filter(match), error: null });
      },
    };
    return q;
  }

  return { data, client: { from: query } };
}
