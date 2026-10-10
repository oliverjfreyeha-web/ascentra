"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call } from "../call";
import { communityFrom, type Community } from "../progress-api";
import { Loading } from "../ui/loading";
import "../learn/c2.css";

/**
 * C2: the Owner's community links (Discord and socials). Outside links, each opening in a new tab; ASCENTRA doesn't run
 * them. Shown to teens unless the Owner hides them. The Owner edits them here (audited, with a reason).
 */
export function CommunityView() {
  const [c, setC] = useState<Community | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/community").then((r) => {
      const v = r._status === 200 ? communityFrom(r) : null;
      setC(v);
      setFailed(v ? null : r.reason ?? "Couldn't load the community links.");
    });
  }, []);
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!c) return <Loading shape="list" />;
  return (
    <>
      <section className="ui-block" aria-labelledby="links-h">
        <h2 id="links-h">Outside links</h2>
        <p className="c2-notice" role="note">{c.note}</p>
        {c.links.length > 0 && (
          <ul className="ui-rows">
            {c.links.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<span className="sr-only"> (outside link, opens in a new tab)</span></a><span className="small muted">Outside link · new tab</span></li>
            ))}
          </ul>
        )}
      </section>
      {c.settings && <OwnerSettings c={c} onSaved={setC} />}
    </>
  );
}

function OwnerSettings({ c, onSaved }: { c: Community; onSaved: (c: Community) => void }) {
  const verified = useReverification(call);
  const s = c.settings!;
  const [discord, setDiscord] = useState(s.discordUrl ?? "");
  const [socials, setSocials] = useState(s.socialLinks.map((l) => `${l.label} | ${l.url}`).join("\n"));
  const [hide, setHide] = useState(s.hideFromTeens);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const socialLinks = socials.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [label, url] = l.split("|").map((x) => x.trim()); return { label, url }; });
    const r = await verified("PUT", "/api/v1/community", { discordUrl: discord.trim() || null, socialLinks, hideFromTeens: hide, reason });
    const v = r && r._status === 200 ? communityFrom(r) : null;
    if (v) { onSaved(v); setReason(""); }
    setMessage(v ? "Saved. Recorded in the audit log with your reason." : r?.reason ?? "Nothing was changed.");
  }
  return (
    <form className="ui-block ui-form" aria-labelledby="community-settings-h" onSubmit={submit}>
      <h2 id="community-settings-h">Community links (Owner)</h2>
      {message && <p role="status">{message}</p>}
      <label>Discord link <input type="url" value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="https://" /></label>
      <label>Social links (one per line: name | https link) <textarea rows={3} value={socials} onChange={(e) => setSocials(e.target.value)} /></label>
      <label><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide these links from teens (14 to 17)</label>
      <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <p className="ui-actions"><button type="submit" disabled={reason.trim().length < 5}>Save links</button></p>
    </form>
  );
}
