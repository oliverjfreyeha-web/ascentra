"use client";

import { useCallback, useEffect, useState } from "react";
import { call } from "../../call";
import { LessonView } from "../../lesson-body";
import { learnerLessonFrom, type LearnerLesson } from "../../courses-api";

/** L2: one published lesson, with its citations and "last verified" date. Progress records the version read. */
export function LessonReader({ id }: { id: string }) {
  const [data, setData] = useState<LearnerLesson | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const url = `/api/v1/learn/lessons/${encodeURIComponent(id)}`;
  const load = useCallback(async () => {
    const r = await call("GET", url);
    const l = r._status === 200 ? learnerLessonFrom(r) : null;
    setData(l);
    setFailed(l ? null : r.reason ?? "Couldn't load this lesson.");
  }, [url]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  if (failed) return <p role="status">{failed}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const v = data.lesson.version;
  async function complete() {
    const r = await call("POST", `${url}/progress`, { versionId: v.id, status: "complete" });
    setMessage(r._status === 200 ? "Marked as done." : r.reason ?? "Couldn't save your progress.");
    await load();
  }
  return (
    <>
      <p className="muted">{data.lesson.course.name}</p>
      <h1>{data.lesson.title}</h1>
      <p className="muted small">Version {v.number}, published {new Date(v.publishedAt).toLocaleDateString()} · Last verified {v.lastVerifiedOn ?? "unknown"}</p>
      <LessonView body={v.body} citations={v.citations} lastVerifiedOn={v.lastVerifiedOn} uncited={v.uncited} />
      {data.progress?.status === "complete"
        ? <p className="muted">Done.</p>
        : <button type="button" onClick={() => void complete()}>Mark as done</button>}
      {message && <p role="status">{message}</p>}
    </>
  );
}
