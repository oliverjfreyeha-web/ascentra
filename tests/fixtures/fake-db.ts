// A small in-memory stand-in for the parts of the Supabase client lib/ uses:
// from(t).select/insert/update/upsert/delete, .eq/.in/.order, .single/.maybeSingle, head counts,
// and .select() after a write. It mimics the unique rules the real schema enforces for
// accounts (one Owner) and role_assignments (one open invite per email, one live role per account).
import { randomUUID } from "node:crypto";
import { ageGroup, ageOn, parseDob, usToday } from "@/lib/age";

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
    // B1: one subscription row per Stripe subscription, one entitlement per subscription (0008).
    if (table === "subscriptions" && candidate.processor_subscription_id != null
      && others.some((r) => r.processor_subscription_id === candidate.processor_subscription_id)) {
      return dup("subscriptions_processor_subscription_id_key");
    }
    if (table === "entitlements" && candidate.subscription_id != null && others.some((r) => r.subscription_id === candidate.subscription_id)) {
      return dup("entitlements_one_per_subscription");
    }
    if (table === "appeals" && candidate.status === "under_review" && others.some((r) => r.status === "under_review" && r.account_id === candidate.account_id)) {
      return dup("appeals_one_open");
    }
    if (table === "session_events" && candidate.event_type === "session" && candidate.ended_at == null
      && others.some((r) => r.event_type === "session" && r.ended_at == null && r.clerk_session_id === candidate.clerk_session_id)) {
      return dup("session_events_one_open");
    }
    // B4: each notice once (notices_dedupe_key_key); one open deletion request per account.
    if (table === "notices" && others.some((r) => r.dedupe_key === candidate.dedupe_key)) return dup("notices_dedupe_key_key");
    if (table === "privacy_requests" && candidate.kind === "deletion" && candidate.status === "open"
      && others.some((r) => r.kind === "deletion" && r.status === "open" && r.account_id === candidate.account_id)) {
      return dup("privacy_requests_one_open_deletion");
    }
    // L1: a library link or file once (0012: sources_library_url, sources_library_file).
    if (table === "sources" && candidate.academy_id == null && candidate.license_class != null) {
      const lib = others.filter((r) => r.academy_id == null && r.license_class != null);
      if (candidate.url && lib.some((r) => String(r.url ?? "").toLowerCase() === String(candidate.url).toLowerCase())) return dup("sources_library_url");
      if (candidate.content_sha256 && lib.some((r) => r.content_sha256 === candidate.content_sha256)) return dup("sources_library_file");
    }
    // L1: one open conflict per pair of claims, either way round (0012: source_conflicts_one_open_pair).
    if (table === "source_conflicts" && (candidate.status ?? "open") === "open") {
      const pair = (r: Row) => [r.claim_a_id, r.claim_b_id].map(String).sort().join("|");
      if (others.some((r) => (r.status ?? "open") === "open" && pair(r) === pair(candidate))) return dup("source_conflicts_one_open_pair");
    }
    // B3: a teen has exactly one Guardian of record (0010: guardian_relationships_one_of_record).
    if (table === "guardian_relationships") {
      const open = (r: Row) => (r.withdrawn_at ?? null) === null && r.verification_status !== "failed";
      if (open(candidate) && others.some((r) => open(r) && r.teen_account_id === candidate.teen_account_id)) {
        return dup("guardian_relationships_one_of_record");
      }
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
        const now = new Date().toISOString();
        const row: Row = { id: randomUUID(), status: table === "accounts" ? "active" : undefined, created_at: now, ...defaults(table, now), ...payload };
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
      if (orderBy) {
        const { col, asc } = orderBy;
        const cmp = (x: unknown, y: unknown) => (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? "")));
        // Stable: rows inserted later sort after earlier ones with the same value (as with created_at ties).
        hit = hit.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => (cmp(a[col], b[col]) || i - j) * (asc ? 1 : -1)).map(([r]) => r);
      }
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
      is(k: string, v: null) {
        filters.push((r) => (r[k] ?? null) === v);
        return q;
      },
      gt(k: string, v: unknown) {
        filters.push((r) => String(r[k]) > String(v));
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

  let appealRef = 200;
  function defaults(table: string, now: string): Row {
    if (table === "appeals") return { reference: `AP-${++appealRef}`, status: "under_review", decided_at: null };
    if (table === "sharing_signals") return { occurred_at: now };
    if (table === "sharing_flags") return { raised_at: now, step_applied: null };
    if (table === "enforcement_steps") return { acknowledged_at: null, limit_until: null };
    if (table === "session_events") return { occurred_at: now, ended_at: null, end_reason: null, conflict: false };
    if (table === "trusted_devices") return { revoked_at: null, trust_state: "pending_verification" };
    if (table === "guardian_relationships") {
      return { guardian_account_id: null, verification_status: "pending", withdrawn_at: null, withdrawal_reason: null, authorized_at: null,
        clerk_invitation_id: null, relationship: null, voice_recordings: "off", uploads: "private" };
    }
    if (table === "consent_records") return { consented_at: now };
    if (table === "privacy_requests") return { status: "open", completed_at: null };
    return {};
  }

  /** Mirrors public.claim_device_slot (0007). JavaScript is single-threaded, so the lock is implicit. */
  function claimDeviceSlot(a: Record<string, unknown>) {
    const devices = (data.trusted_devices ??= []);
    const now = new Date().toISOString();
    const trusted = devices.filter((d) => d.account_id === a.p_account && d.trust_state === "trusted");
    const existing = trusted.find((d) => d.device_key_hash === a.p_key_hash);
    if (existing) {
      existing.last_seen_at = now;
      return { outcome: "existing", device_id: existing.id, replaced_id: null };
    }
    if (a.p_replace) {
      if (!trusted.some((d) => d.id === a.p_replace)) return { outcome: "not_found", device_id: null, replaced_id: null };
    } else if (trusted.length >= (a.p_limit as number)) {
      return { outcome: "full", device_id: null, replaced_id: null };
    }
    const row: Row = {
      id: randomUUID(), account_id: a.p_account, name: a.p_name, kind: a.p_kind, trust_state: "trusted", approx_region: a.p_region,
      last_seen_at: now, device_key_hash: a.p_key_hash, trusted_at: now, created_at: now, revoked_at: null,
    };
    devices.push(row);
    if (a.p_replace) {
      Object.assign(devices.find((d) => d.id === a.p_replace)!, { trust_state: "revoked", revoked_at: now, revoked_reason: "replaced", replaced_by_id: row.id });
      return { outcome: "replaced", device_id: row.id, replaced_id: a.p_replace };
    }
    return { outcome: "registered", device_id: row.id, replaced_id: null };
  }

  /** Mirrors public.support_change_date_of_birth (0009). */
  function supportChangeDob(a: Record<string, unknown>) {
    const row = data.accounts.find((r) => r.id === a.p_account);
    if (!row) return "not_found";
    if (row.role !== "learner" || !row.date_of_birth) return "no_date_of_birth";
    if (a.p_dob === row.date_of_birth) return "unchanged";
    const dob = parseDob(a.p_dob, usToday());
    if (!dob) return "invalid";
    const group = ageGroup(ageOn(dob, usToday()));
    if (group === "under_minimum" || (group === "teen") !== row.is_minor) return "changes_age_group";
    row.date_of_birth = a.p_dob;
    return "changed";
  }

  /** Mirrors public.put_source_chunks (0012): a web_summarize_only source keeps only a short quote per chunk. */
  function putSourceChunks(a: Record<string, unknown>) {
    const src = (data.sources ?? []).find((r) => r.id === a.p_source);
    if (!src) return { data: null, error: { code: "P0002", message: "no such source" } };
    data.source_chunks = (data.source_chunks ?? []).filter((c) => c.source_id !== a.p_source);
    const excerpt = src.license_class === "web_summarize_only";
    for (const c of a.p_chunks as { position: number; text: string; quote?: string; embedding?: number[] }[]) {
      data.source_chunks.push({
        id: randomUUID(), source_id: a.p_source, position: c.position, is_excerpt: excerpt, embedding: c.embedding ?? null,
        content: excerpt ? (c.quote || c.text).slice(0, 300) : c.text, search_text: c.text.toLowerCase(), created_at: new Date().toISOString(),
      });
    }
    src.chunk_count = (a.p_chunks as unknown[]).length;
    return { data: src.chunk_count, error: null };
  }
  /** Mirrors public.match_source_chunks (0012) with word matching in place of full-text ranking. */
  function matchSourceChunks(a: Record<string, unknown>) {
    const words = String(a.p_query ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const rows = (data.source_chunks ?? []).flatMap((c) => {
      const s = (data.sources ?? []).find((r) => r.id === c.source_id);
      if (!s || s.status !== "approved" || s.academy_id) return [];
      const score = words.filter((w) => String(c.search_text).includes(w)).length;
      return score ? [{ chunk_id: c.id, source_id: s.id, title: s.title, url: s.url ?? null, license_class: s.license_class, license_name: s.license_name ?? null, content: c.content, is_excerpt: c.is_excerpt, score }] : [];
    });
    return { data: rows.sort((x, y) => y.score - x.score).slice(0, Number(a.p_limit ?? 8)), error: null };
  }
  const uploads: { path: string; size: number; contentType?: string }[] = [];
  const storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, opts?: { contentType?: string }) => {
        uploads.push({ path, size: bytes.byteLength, contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) uploads.splice(uploads.findIndex((u) => u.path === p), 1);
        return { data: null, error: null };
      },
    }),
  };

  const rpc = async (fn: string, args: Record<string, unknown> = {}) =>
    fn === "put_source_chunks" ? putSourceChunks(args) :
    fn === "match_source_chunks" ? matchSourceChunks(args) :
    fn === "support_change_date_of_birth" ? { data: supportChangeDob(args), error: null } :
    fn === "audit_verify_chain"
      ? { data: [{ ok: true, checked: data.audit_events.length, broken_at_seq: null, problem: null, head_seq: data.audit_events.length || null, head_hash: data.audit_events.at(-1)?.row_hash ?? null }], error: null }
      : fn === "claim_device_slot"
        ? { data: [claimDeviceSlot(args)], error: null }
        : { data: null, error: { code: "42883", message: `no function ${fn}` } };

  return { data, uploads, client: { from: query, rpc, storage } };
}
