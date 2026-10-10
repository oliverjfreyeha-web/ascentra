// A small in-memory stand-in for the parts of the Supabase client lib/ uses:
// from(t).select/insert/update/upsert/delete, .eq/.in/.order, .single/.maybeSingle, head counts,
// and .select() after a write. It mimics the unique rules the real schema enforces for
// accounts (one Owner) and role_assignments (one open invite per email, one live role per account).
import { randomUUID } from "node:crypto";
import { ageGroup, ageOn, parseDob, usToday } from "@/lib/age";
import { applyPause, applyPick, reconcile, type PickPlan, type PickRow, type TopicRow } from "@/lib/picks/rules";

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
    // Postgres ILIKE: % any run, _ one character, a backslash escapes the next character.
    const like = (v: unknown, pattern: string) => {
      let re = "";
      for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "\\" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        else if (ch === "%") re += ".*";
        else if (ch === "_") re += ".";
        else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp(`^${re}$`, "i").test(String(v ?? ""));
    };

    const run = (): { data: unknown; error: Err; count?: number } => {
      const match = (r: Row) => filters.every((f) => f(r));
      if (op === "insert") {
        const now = new Date().toISOString();
        // Like Supabase: an array inserts several rows, all or nothing.
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made: Row[] = [];
        for (const item of items) {
          const row: Row = { id: randomUUID(), status: table === "accounts" ? "active" : undefined, created_at: now, ...defaults(table, now), ...item };
          // audit_events: the database numbers rows (0006's chain trigger); mirror the numbering here.
          if (table === "audit_events") Object.assign(row, { seq: rows().length + 1, occurred_at: new Date().toISOString(), row_hash: `hash${rows().length + 1}` });
          const err = violates(table, row);
          if (err) {
            made.forEach((m) => rows().splice(rows().indexOf(m), 1));
            return { data: null, error: err };
          }
          rows().push(row);
          made.push(row);
        }
        return { data: made, error: null };
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

  // L4: count_mentor_message (one row per account and day).
  function countMentorMessage(a: Record<string, unknown>) {
    data.mentor_daily_usage ??= [];
    let row = data.mentor_daily_usage.find((r) => r.account_id === a.p_account && r.day === a.p_day);
    if (!row) { row = { id: randomUUID(), account_id: a.p_account, day: a.p_day, messages: 0 }; data.mentor_daily_usage.push(row); }
    row.messages = Number(row.messages) + 1;
    return { data: row.messages, error: null };
  }
  // L6: publish_module_activities (0017): the variety rule, then archive what approved refresh drafts replace, then publish.
  function publishModuleActivities(a: Record<string, unknown>) {
    const items = (data.activity_items ?? []).filter((i) => i.module_id === a.p_module);
    const replaced = new Set(items.filter((i) => i.status === "approved" && i.previous_item_id).map((i) => i.previous_item_id));
    const types = new Set(items.filter((i) => i.status === "approved" || (i.status === "published" && !replaced.has(i.id))).map((i) => i.item_type)).size;
    if (types < 3) return { data: null, error: { code: "23514", message: `ASCENTRA: a module needs at least 3 different activity types to be published (this one has ${types}).` } };
    const now = new Date().toISOString();
    for (const i of items) if (i.status === "published" && replaced.has(i.id)) Object.assign(i, { status: "archived", archived_at: now });
    let n = 0;
    for (const i of items) if (i.status === "approved") { Object.assign(i, { status: "published", published_at: now, published_by_account_id: a.p_actor }); n++; }
    return { data: n, error: null };
  }
  // L7: request_course (0018): one anonymous row per topic and level, counted.
  function requestCourse(a: Record<string, unknown>) {
    data.course_requests ??= [];
    const now = new Date().toISOString();
    let row = data.course_requests.find((r) => r.topic_key === a.p_key && r.level === a.p_level);
    if (row) Object.assign(row, { request_count: Number(row.request_count) + 1, last_requested_at: now, ...(row.status === "dismissed" ? { status: "open", decided_at: null } : {}) });
    else data.course_requests.push(row = { id: randomUUID(), topic: a.p_topic, topic_key: a.p_key, level: a.p_level, request_count: 1, status: "open", decided_at: null, decision_note: null, last_requested_at: now, created_at: now });
    return { data: row.id, error: null };
  }
  // L8: the pick functions (0019), with the same rules (lib/picks/rules.ts), one learner at a time.
  function picksFn(fn: string, a: Record<string, unknown>) {
    if (!["trial", "basic", "pro"].includes(String(a.p_plan))) return { data: null, error: { code: "23514", message: "ASCENTRA: picks need a plan: trial, basic or pro." } };
    const plan = a.p_plan as PickPlan;
    const account = data.accounts.find((r) => r.id === a.p_account);
    if (!account) return { data: fn === "reconcile_picks" ? 0 : { result: fn === "pause_pick" ? "not_picked" : "no_account" }, error: null };
    data.learner_picks ??= [];
    const topics = (data.topics ?? []) as unknown as TopicRow[];
    const mine = data.learner_picks.filter((r) => r.user_id === a.p_account) as unknown as PickRow[];
    const minor = account.is_minor === true;
    const now = new Date(Date.now() + data.learner_picks.length).toISOString();
    const store = (before: number) => { for (const p of mine.slice(before)) data.learner_picks.push({ id: randomUUID(), ...p } as unknown as Row); };
    if (fn === "reconcile_picks") return { data: reconcile(mine, topics, plan, minor), error: null };
    if (fn === "pause_pick") return { data: applyPause(mine, topics, String(a.p_topic), plan, minor), error: null };
    if (fn === "pick_topic") {
      if (account.status !== "active") return { data: { result: "no_account" }, error: null };
      const n = mine.length;
      const r = applyPick(mine, topics, String(a.p_topic), String(a.p_account), plan, minor, now);
      store(n);
      if (r.result === "picked" && !r.has_course) {
        data.topic_interest ??= [];
        const t = usToday();
        const day = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
        const row = data.topic_interest.find((x) => x.topic_id === a.p_topic && x.day === day);
        if (row) row.count = Number(row.count) + 1; else data.topic_interest.push({ id: randomUUID(), topic_id: a.p_topic, day, count: 1 });
      }
      return { data: r, error: null };
    }
    // owner_set_business and owner_set_pick (C2: a business or a side hustle)
    const kind = fn === "owner_set_pick" ? String(a.p_kind) : "business";
    if (kind !== "business" && kind !== "side_hustle") return { data: null, error: { code: "23514", message: "ASCENTRA: the Owner changes a business or a side hustle." } };
    reconcile(mine, topics, plan, minor);
    const current = mine.find((p) => p.kind === kind && p.status === "active");
    if (a.p_topic == null) {
      if (!current) return { data: { result: "unchanged", previous: null, next: null }, error: null };
      Object.assign(current, { status: "paused", locked: false });
      return { data: { result: "released", previous: current.topic_id, next: null }, error: null };
    }
    const t = topics.find((x) => x.id === a.p_topic);
    if (!t || t.kind !== kind || !t.published || (t.teen_hidden && minor)) return { data: { result: "not_available" }, error: null };
    if (current?.topic_id === t.id) return { data: { result: "unchanged", previous: t.id, next: t.id }, error: null };
    if (current) Object.assign(current, { status: "paused", locked: false });
    const existing = mine.find((p) => p.topic_id === t.id);
    if (existing) Object.assign(existing, { status: "active", picked_at: now, locked: plan !== "pro" });
    else data.learner_picks.push({ id: randomUUID(), user_id: a.p_account, topic_id: t.id, kind, status: "active", locked: plan !== "pro", picked_at: now });
    return { data: { result: "changed", previous: current?.topic_id ?? null, next: t.id }, error: null };
  }
  // C2: completions (once per item, on the learner's own day) and the totals from them (0021).
  function recordCompletion(a: Record<string, unknown>) {
    data.item_completions ??= [];
    const exists = data.item_completions.some((r) => r.account_id === a.p_account && r.item_kind === a.p_kind && r.item_id === a.p_item);
    const tz = (data.profiles?.find((p) => p.account_id === a.p_account)?.time_zone as string | undefined) ?? "America/New_York";
    const local_day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (!exists) data.item_completions.push({ id: randomUUID(), account_id: a.p_account, course_id: a.p_course, module_id: a.p_module ?? null, lesson_id: a.p_lesson ?? null,
      item_kind: a.p_kind, item_id: a.p_item, importance: a.p_importance ?? null, points: a.p_points, local_day, completed_at: new Date().toISOString() });
    return { data: { created: !exists, local_day }, error: null };
  }
  function progressTotals(a: Record<string, unknown>) {
    const mine = (data.item_completions ?? []).filter((r) => r.account_id === a.p_account);
    const days = [...new Set(mine.map((r) => String(r.local_day)))].sort();
    const n = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
    let longest = 0, run = 0, prev = Number.NaN, lastRun = 0, lastDay = Number.NaN;
    for (const d of days.map(n)) { run = d === prev + 1 ? run + 1 : 1; prev = d; longest = Math.max(longest, run); lastRun = run; lastDay = d; }
    const tz = (data.profiles?.find((p) => p.account_id === a.p_account)?.time_zone as string | undefined) ?? "America/New_York";
    const today = n(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    return { data: [{ points: mine.reduce((s, r) => s + Number(r.points), 0), current_streak: lastDay >= today - 1 ? lastRun : 0, longest_streak: longest }], error: null };
  }
  const rpc = async (fn: string, args: Record<string, unknown> = {}) =>
    fn === "record_item_completion" ? recordCompletion(args) :
    fn === "learner_progress_totals" ? progressTotals(args) :
    fn === "leaderboard_adults" ? { data: [], error: null } :
    ["pick_topic", "pause_pick", "reconcile_picks", "owner_set_business", "owner_set_pick"].includes(fn) ? picksFn(fn, args) :
    fn === "request_course" ? requestCourse(args) :
    fn === "publish_module_activities" ? publishModuleActivities(args) :
    fn === "count_mentor_message" ? countMentorMessage(args) :
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
