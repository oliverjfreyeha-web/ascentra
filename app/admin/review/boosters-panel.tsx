"use client";

import { useCallback, useEffect, useState } from "react";
import { call } from "../../call";
import { boostersFrom, type BoosterList } from "../../studio-api";
import { Loading } from "../../ui/loading";

type B = BoosterList["boosters"][number];

/** C1: the learning boosters each module's recipe picks from. The Owner adds, edits and turns them on or off; every change is audited. */
export function BoostersPanel() {
  const [data, setData] = useState<BoosterList | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/boosters");
    setData(r._status === 200 ? boostersFrom(r) : null);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
  useEffect(() => { void load(); }, [load]);
  async function send(method: string, url: string, body: unknown, done: string) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    setMessage(r._status < 300 ? done : r.reason ?? "Nothing was changed.");
    await load();
    return r._status < 300;
  }
  if (!data) return <Loading />;
  return (
    <section aria-labelledby="boosters-h">
      <h2 id="boosters-h">Learning boosters</h2>
      <p className="muted small">Each booster is carried by practice items of the kinds listed, with the same sources, citations and review as any other item.</p>
      {message && <p role="status">{message}</p>}
      <ul className="studio__boosters">
        {data.boosters.map((b) => <li key={b.id}><BoosterRow b={b} types={data.types} busy={busy} send={send} /></li>)}
      </ul>
      <BoosterForm types={data.types} busy={busy} submitLabel="Add booster" onSubmit={(body) => send("POST", "/api/v1/boosters", body, `Added "${String(body.name)}".`)} />
    </section>
  );
}

function BoosterRow({ b, types, busy, send }: { b: B; types: BoosterList["types"]; busy: boolean; send: (m: string, u: string, body: unknown, done: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const label = (t: string) => types.find((x) => x.type === t)?.label ?? t;
  if (editing) return <BoosterForm types={types} busy={busy} initial={b} submitLabel="Save" onSubmit={(body) => send("PATCH", `/api/v1/boosters/${b.id}`, body, `Saved "${b.name}".`).then((ok) => { if (ok) setEditing(false); return ok; })} onCancel={() => setEditing(false)} />;
  return (
    <>
      <strong>{b.name}</strong>{!b.active && <span className="muted"> (off)</span>} <span className="muted small">· {b.itemTypes.map(label).join(", ")} · used by {b.inUse} item{b.inUse === 1 ? "" : "s"}</span>
      {b.description && <div className="small">{b.description}</div>}
      <div className="small">
        <button type="button" className="link" onClick={() => setEditing(true)}>Edit<span className="sr-only">: {b.name}</span></button>{" · "}
        <button type="button" className="link" disabled={busy} onClick={() => send("PATCH", `/api/v1/boosters/${b.id}`, { active: !b.active }, `${b.name}: turned ${b.active ? "off" : "on"}.`)}>
          {b.active ? "Turn off" : "Turn on"}<span className="sr-only">: {b.name}</span>
        </button>
      </div>
    </>
  );
}

function BoosterForm({ types, busy, initial, submitLabel, onSubmit, onCancel }: {
  types: BoosterList["types"]; busy: boolean; initial?: B; submitLabel: string; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [picked, setPicked] = useState<string[]>(initial?.itemTypes ?? []);
  return (
    <form className="ui-form" aria-label={initial ? `Edit ${initial.name}` : "Add a booster"} onSubmit={(e) => {
      e.preventDefault();
      void onSubmit({ name, description, itemTypes: picked }).then((ok) => { if (ok && !initial) { setName(""); setDescription(""); setPicked([]); } });
    }}>
      {!initial && <h3>Add a booster</h3>}
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label>What it is <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label>
      <fieldset>
        <legend>Kinds of practice that carry it (1 to 4)</legend>
        <p className="studio__row">
          {types.map((t) => (
            <label key={t.type} className="studio__check">
              <input type="checkbox" checked={picked.includes(t.type)} disabled={!picked.includes(t.type) && picked.length >= 4}
                onChange={(e) => setPicked(e.target.checked ? [...picked, t.type] : picked.filter((x) => x !== t.type))} /> {t.label}
            </label>
          ))}
        </p>
      </fieldset>
      <p className="ui-actions">
        <button type="submit" disabled={busy || name.trim().length < 3 || !picked.length}>{submitLabel}</button>
        {onCancel && <> <button type="button" onClick={onCancel}>Cancel</button></>}
      </p>
    </form>
  );
}
