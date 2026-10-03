"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { call, when, type ApiResult } from "../../call";

type Source = {
  id: string; title: string; url: string | null; kind: string; licenseClass: string; licenseName: string | null; status: string;
  foundAt: string; approvedAt: string | null; lastCheckedAt: string | null; chunks: number; hasFile: boolean;
};
type ClaimView = { id: string; claim: string; quote: string | null; source: { id: string; title: string; license: string; url: string | null } | null } | null;
type Conflict = {
  id: string; status: string; reasons: string[]; detectedBy: string; createdAt: string; a: ClaimView; b: ClaimView;
  decisions: { version: number; chosenClaimId: string; decision: string; rationale: string; decidedAt: string }[];
};
type Claim = { id: string; sourceId: string | null; claim: string; quote: string | null; citation: string; by: string };
type OpenItem = { id: string; title: string; url: string; license_name: string; notes: string | null };
type Hit = { chunkId: string; text: string; isExcerpt: boolean; score: number; citation: { title: string; url: string | null; license: string; licenseName: string | null } };
type Ai = {
  configured: boolean; embeddings: boolean; models: Record<string, string>; caps: { perDay: number; perMonth: number };
  spent: { day: number; month: number }; connections: Record<string, { status: string; reason: string | null; checked_at: string | null }>;
};

const LICENSE: Record<string, string> = { open: "Open license", owner_supplied: "Owner-supplied", web_summarize_only: "Web (summarize only)" };
const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;
const said = (r: ApiResult, okText: string) => (r._status < 300 ? okText : r.reason ?? "Nothing was changed.");

export function SourceLibrary() {
  const [role, setRole] = useState<string | null>(null);
  const [filters, setFilters] = useState({ license: "", status: "", olderThanDays: "" });
  const [sources, setSources] = useState<Source[] | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [ai, setAi] = useState<Ai | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = role === "owner" || role === "reviewer";

  const load = useCallback(async () => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    const [s, c, cl, o] = await Promise.all([
      call("GET", `/api/v1/sources?${p}`), call("GET", "/api/v1/sources/conflicts"), call("GET", "/api/v1/sources/claims"), call("GET", "/api/v1/sources/open-list"),
    ]);
    if (s._status !== 200) { setMessage(s.reason ?? "You can't see the source library."); setSources([]); return; }
    setSources(s.sources as Source[]);
    setConflicts((c.conflicts as Conflict[]) ?? []);
    setClaims((cl.claims as Claim[]) ?? []);
    setOpenItems((o.items as OpenItem[]) ?? []);
  }, [filters]);

  const loadAi = useCallback(async () => {
    const r = await call("GET", "/api/v1/ai");
    setAi(r._status === 200 ? (r as unknown as Ai) : null);
  }, []);

  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(m.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void loadAi();
  }, [loadAi]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the API when the filters change
    void load();
  }, [load]);

  async function act(run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) {
    setBusy(true);
    setMessage(null);
    const r = await run();
    setBusy(false);
    setMessage(said(r, okText(r)));
    await load();
    return r;
  }
  const ask = (what: string) => {
    const reason = window.prompt(`Reason for ${what} (recorded in the audit log):`)?.trim();
    return reason || null;
  };

  return (
    <>
      {message && <p role="status" className="notice">{message}</p>}
      <AiPanel ai={ai} canCheck={role === "owner" || role === "superAdmin"} onCheck={async () => {
        setBusy(true);
        const r = await call("POST", "/api/v1/ai/health");
        setBusy(false);
        setMessage(r._status === 200 ? `Health check: ${r.status === "connected" ? "Connected" : "Disconnected"}. ${r.detail ?? ""}` : r.reason ?? "Check failed.");
        await loadAi();
      }} busy={busy} />

      {canEdit && <AddSource busy={busy} openItems={openItems} act={act} />}

      <section aria-labelledby="ledger-h">
        <h2 id="ledger-h">Sources</h2>
        <div className="filters">
          <label>License{" "}
            <select value={filters.license} onChange={(e) => setFilters({ ...filters, license: e.target.value })}>
              <option value="">Any</option>
              {Object.entries(LICENSE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>{" "}
          <label>Status{" "}
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any</option>
              {["proposed", "approved", "rejected", "stale"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>{" "}
          <label>Not checked for more than{" "}
            <select value={filters.olderThanDays} onChange={(e) => setFilters({ ...filters, olderThanDays: e.target.value })}>
              <option value="">any age</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">a year</option>
            </select>
          </label>
        </div>
        {sources === null ? <p className="muted">Loading…</p> : sources.length === 0 ? <p className="muted">No sources.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Source</th><th>License</th><th>Status</th><th>Found</th><th>Approved</th><th>Last checked</th><th>Passages</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}{s.hasFile ? " (uploaded file)" : ""}</td>
                    <td>{LICENSE[s.licenseClass] ?? s.licenseClass}{s.licenseName ? ` · ${s.licenseName}` : ""}</td>
                    <td>{s.status}</td>
                    <td>{when(s.foundAt)}</td>
                    <td>{when(s.approvedAt)}</td>
                    <td>{when(s.lastCheckedAt)}</td>
                    <td>{s.chunks}</td>
                    {canEdit && (
                      <td>
                        {s.status !== "approved" && (
                          <button type="button" disabled={busy} onClick={() => { const reason = ask(`approving "${s.title}"`); if (reason) void act(() => call("POST", `/api/v1/sources/${s.id}/approve`, { reason }), () => "Approved. Search returns it and lessons can cite it."); }}>Approve</button>
                        )}{" "}
                        {s.status !== "rejected" && (
                          <button type="button" disabled={busy} onClick={() => { const reason = ask(`rejecting "${s.title}"`); if (reason) void act(() => call("POST", `/api/v1/sources/${s.id}/reject`, { reason }), () => "Rejected."); }}>Reject</button>
                        )}{" "}
                        {s.status === "approved" && (
                          <button type="button" disabled={busy} onClick={() => void act(() => call("POST", `/api/v1/sources/${s.id}/claims`, {}),
                            (r) => `Extracted ${r.claims ?? 0} cited claim(s); ${r.conflicts ?? 0} new conflict(s).`)}>Extract claims (AI)</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Search />

      <section aria-labelledby="conf-h">
        <h2 id="conf-h">Conflicts</h2>
        <p className="muted">When two approved sources disagree, a Reviewer records an authority decision: which source is followed, and why.</p>
        {conflicts.length === 0 ? <p className="muted">No conflicts.</p> : conflicts.map((c) => (
          <ConflictCard key={c.id} c={c} canDecide={canEdit} busy={busy} act={act} />
        ))}
        {canEdit && <AddClaimAndConflict sources={sources ?? []} claims={claims} busy={busy} act={act} />}
      </section>

      <section aria-labelledby="open-h">
        <h2 id="open-h">Open-license list</h2>
        <p className="muted">Sources under an open license that can be added in one step. The Owner edits this list.</p>
        {openItems.length === 0 ? <p className="muted">The list is empty.</p> : (
          <ul>
            {openItems.map((o) => (
              <li key={o.id}>
                <a href={o.url} target="_blank" rel="noreferrer noopener">{o.title}</a> · {o.license_name}{o.notes ? ` · ${o.notes}` : ""}{" "}
                {role === "owner" && (
                  <button type="button" className="link" disabled={busy} onClick={() => { const reason = ask(`removing "${o.title}"`); if (reason) void act(() => call("DELETE", `/api/v1/sources/open-list/${o.id}`, { reason }), () => "Removed from the list."); }}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {role === "owner" && <AddOpenItem busy={busy} act={act} />}
      </section>
    </>
  );
}

type Act = (run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) => Promise<ApiResult>;

function AiPanel({ ai, canCheck, onCheck, busy }: { ai: Ai | null; canCheck: boolean; onCheck: () => void; busy: boolean }) {
  if (!ai) return null;
  const conn = ai.connections.anthropic;
  return (
    <section aria-labelledby="ai-h">
      <h2 id="ai-h">AI</h2>
      {!ai.configured ? (
        <p>AI is off: ANTHROPIC_API_KEY isn&apos;t set. The library, search (full-text) and hand-entered claims still work.</p>
      ) : (
        <dl className="kv">
          <dt>Status</dt><dd>{conn?.status === "connected" ? "Connected" : "Not connected"}{conn?.checked_at ? ` (checked ${when(conn.checked_at)})` : " (no health check yet)"}{conn?.reason ? ` · ${conn.reason}` : ""}</dd>
          <dt>Models</dt><dd>{Object.entries(ai.models).map(([job, m]) => `${job}: ${m}`).join(" · ")}</dd>
          <dt>Spend today</dt><dd>{usd(ai.spent.day)} of {usd(ai.caps.perDay)}</dd>
          <dt>Spend this month</dt><dd>{usd(ai.spent.month)} of {usd(ai.caps.perMonth)}</dd>
          <dt>Search</dt><dd>{ai.embeddings ? "Embeddings (Voyage) with full-text fallback" : "Full-text (VOYAGE_API_KEY isn't set)"}</dd>
        </dl>
      )}
      {canCheck && ai.configured && <button type="button" disabled={busy} onClick={onCheck}>Run health check</button>}
    </section>
  );
}

function AddSource({ busy, openItems, act }: { busy: boolean; openItems: OpenItem[]; act: Act }) {
  const [how, setHow] = useState<"url" | "upload" | "open">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [licenseClass, setLicenseClass] = useState("web_summarize_only");
  const [licenseName, setLicenseName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [openId, setOpenId] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const added = (r: ApiResult) => `Added as proposed (${r.chunks ?? 0} passage(s) for search). Approve it to make it citable.`;
    if (how === "open") return void act(() => call("POST", "/api/v1/sources", { openListId: openId }), added);
    if (how === "url") return void act(() => call("POST", "/api/v1/sources", { url, title: title || undefined, licenseClass, licenseName: licenseName || undefined }), added);
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    if (title) form.set("title", title);
    form.set("licenseClass", licenseClass);
    if (licenseName) form.set("licenseName", licenseName);
    await act(async () => {
      const res = await fetch("/api/v1/sources/upload", { method: "POST", body: form, cache: "no-store" });
      return { ...((await res.json().catch(() => ({}))) as Record<string, unknown>), _status: res.status };
    }, added);
  }

  return (
    <section aria-labelledby="add-h">
      <h2 id="add-h">Add a source</h2>
      <form onSubmit={submit}>
        <fieldset>
          <legend>How</legend>
          <label><input type="radio" checked={how === "url"} onChange={() => setHow("url")} /> By link</label>{" "}
          <label><input type="radio" checked={how === "upload"} onChange={() => setHow("upload")} /> Upload a PDF or text file</label>{" "}
          <label><input type="radio" checked={how === "open"} onChange={() => setHow("open")} /> From the open-license list</label>
        </fieldset>
        {how === "open" ? (
          <p><label>Entry{" "}
            <select value={openId} onChange={(e) => setOpenId(e.target.value)} required>
              <option value="">Choose…</option>
              {openItems.map((o) => <option key={o.id} value={o.id}>{o.title} ({o.license_name})</option>)}
            </select>
          </label></p>
        ) : (
          <>
            {how === "url"
              ? <p><label>Link (https) <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required /></label></p>
              : <p><label>File (PDF or text, up to 4 MB) <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></label></p>}
            <p><label>Title (optional) <input value={title} onChange={(e) => setTitle(e.target.value)} /></label></p>
            <p><label>License{" "}
              <select value={licenseClass} onChange={(e) => setLicenseClass(e.target.value)}>
                {Object.entries(LICENSE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>{" "}
            <label>License name (optional, e.g. CC BY 4.0) <input value={licenseName} onChange={(e) => setLicenseName(e.target.value)} /></label></p>
            <p className="muted small">
              Web (summarize only): only short quotes are kept; the full text is used for search and not stored. Owner-supplied sources are approved by the Owner.
            </p>
          </>
        )}
        <button type="submit" disabled={busy}>Add as proposed</button>
      </form>
    </section>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ mode: string; results: Hit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(e: FormEvent) {
    e.preventDefault();
    const r = await call("GET", `/api/v1/sources/search?q=${encodeURIComponent(q)}`);
    if (r._status === 200) { setResult(r as unknown as { mode: string; results: Hit[] }); setError(null); } else { setResult(null); setError(r.reason ?? "Search failed."); }
  }
  return (
    <section aria-labelledby="search-h">
      <h2 id="search-h">Search approved sources</h2>
      <form onSubmit={run}><label>Topic <input value={q} onChange={(e) => setQ(e.target.value)} required /></label> <button type="submit">Search</button></form>
      {error && <p role="status">{error}</p>}
      {result && (result.results.length === 0 ? <p className="muted">No approved passage matches.</p> : (
        <ol>
          {result.results.map((h) => (
            <li key={h.chunkId}>
              {h.isExcerpt ? <q>{h.text}</q> : h.text}{" "}
              <span className="muted small">— {h.citation.url ? <a href={h.citation.url} target="_blank" rel="noreferrer noopener">{h.citation.title}</a> : h.citation.title} · {LICENSE[h.citation.license] ?? h.citation.license}</span>
            </li>
          ))}
        </ol>
      ))}
      {result && <p className="muted small">Ranked by {result.mode === "embedding" ? "embeddings" : "full-text search"}.</p>}
    </section>
  );
}

function ConflictCard({ c, canDecide, busy, act }: { c: Conflict; canDecide: boolean; busy: boolean; act: Act }) {
  const [chosen, setChosen] = useState("");
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const side = (v: ClaimView, label: string) => v && (
    <label>
      {canDecide && <input type="radio" name={`chosen-${c.id}`} checked={chosen === v.id} onChange={() => setChosen(v.id)} />}{" "}
      <strong>{label}:</strong> {v.claim}{v.quote ? <> <q>{v.quote}</q></> : null}{" "}
      <span className="muted small">— {v.source ? `${v.source.title} (${LICENSE[v.source.license] ?? v.source.license})` : "no source"}</span>
    </label>
  );
  const last = c.decisions.at(-1);
  return (
    <form className="notice" onSubmit={(e) => { e.preventDefault(); void act(() => call("POST", `/api/v1/sources/conflicts/${c.id}/decide`, { chosenClaimId: chosen, decision, reason }), (r) => `Authority decision v${r.version} recorded.`); }}>
      <p className="muted small">{c.status} · found by {c.detectedBy === "ai" ? "AI" : "a person"} · {when(c.createdAt)}{c.reasons?.length ? ` · ${c.reasons.join("; ")}` : ""}</p>
      <p>{side(c.a, "A")}</p>
      <p>{side(c.b, "B")}</p>
      {last && <p>Decision v{last.version}: {last.decision}. Why: {last.rationale} <span className="muted small">({when(last.decidedAt)})</span></p>}
      {canDecide && (
        <p>
          <label>Decision <input value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Follow source A" required /></label>{" "}
          <label>Why (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>{" "}
          <button type="submit" disabled={busy || !chosen}>{last ? "Record a new decision" : "Record decision"}</button>
        </p>
      )}
    </form>
  );
}

function AddClaimAndConflict({ sources, claims, busy, act }: { sources: Source[]; claims: Claim[]; busy: boolean; act: Act }) {
  const [claim, setClaim] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [quote, setQuote] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [why, setWhy] = useState("");
  const approved = sources.filter((s) => s.status === "approved");
  const title = (id: string | null) => (id ? sources.find((s) => s.id === id)?.title ?? "a source" : "no source");
  return (
    <>
      <h3>Add a claim by hand</h3>
      <form onSubmit={(e) => { e.preventDefault(); void act(() => call("POST", "/api/v1/sources/claims", { claim, sourceId: sourceId || undefined, citedText: quote || undefined }), (r) => (r.citation === "no_source" ? "Claim added, marked as having no source." : "Cited claim added.")); }}>
        <p><label>Claim <input value={claim} onChange={(e) => setClaim(e.target.value)} required /></label></p>
        <p><label>Cites{" "}
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">No source (marked as such)</option>
            {approved.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>{" "}
        {sourceId && <label>Quote from the source <input value={quote} onChange={(e) => setQuote(e.target.value)} required /></label>}</p>
        <button type="submit" disabled={busy}>Add claim</button>
      </form>
      <h3>Open a conflict by hand</h3>
      <form onSubmit={(e) => { e.preventDefault(); void act(() => call("POST", "/api/v1/sources/conflicts", { claimAId: a, claimBId: b, why }), () => "Conflict opened; it's in the Reviewer queue above."); }}>
        {[["Claim A", a, setA], ["Claim B", b, setB]].map(([label, v, set]) => (
          <p key={label as string}><label>{label as string}{" "}
            <select value={v as string} onChange={(e) => (set as (x: string) => void)(e.target.value)} required>
              <option value="">Choose…</option>
              {claims.filter((c) => c.citation === "cited").map((c) => <option key={c.id} value={c.id}>{c.claim} — {title(c.sourceId)}</option>)}
            </select>
          </label></p>
        ))}
        <p><label>How they disagree <input value={why} onChange={(e) => setWhy(e.target.value)} required /></label></p>
        <button type="submit" disabled={busy}>Open conflict</button>
      </form>
    </>
  );
}

function AddOpenItem({ busy, act }: { busy: boolean; act: Act }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); void act(() => call("POST", "/api/v1/sources/open-list", { title, url, licenseName, reason }), () => "Added to the open-license list."); }}>
      <p>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>{" "}
        <label>Link (https) <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required /></label>{" "}
        <label>License (e.g. CC BY 4.0) <input value={licenseName} onChange={(e) => setLicenseName(e.target.value)} required /></label>{" "}
        <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>{" "}
        <button type="submit" disabled={busy}>Add to list</button>
      </p>
    </form>
  );
}
