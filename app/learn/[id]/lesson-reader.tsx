"use client";

import { useCallback, useEffect, useState } from "react";
import { call } from "../../call";
import { LessonView } from "../../lesson-body";
import { MentorPanel } from "./mentor-panel";
import { Practice } from "./practice";
import { lessonActivitiesFrom, type LearnerActivity } from "../../activities-api";
import { learnerLessonFrom, type LearnerLesson } from "../../courses-api";

/** L2: one published lesson, with its citations and "last verified" date. Progress records the version read. */
export function LessonReader({ id }: { id: string }) {
  const [current, setCurrent] = useState(false);
  const [data, setData] = useState<LearnerLesson | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [practice, setPractice] = useState<{ activities: LearnerActivity[]; score: { graded: number; correct: number } } | null>(null);
  const url = `/api/v1/learn/lessons/${encodeURIComponent(id)}`;
  const load = useCallback(async () => {
    const r = await call("GET", current ? `${url}?view=current` : url);
    const l = r._status === 200 ? learnerLessonFrom(r) : null;
    setData(l);
    setPractice(r._status === 200 ? lessonActivitiesFrom(r) : null);
    setFailed(l ? null : r.reason ?? "Couldn't load this lesson.");
  }, [url, current]);
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
  const update = data.update;
  async function switchToUpdated() {
    if (!update) return;
    // Their progress is kept: a lesson they completed stays complete on the new version.
    const r = await call("POST", `${url}/progress`, { versionId: update.versionId, status: data!.progress?.status === "complete" ? "complete" : "in_progress", carry: true });
    setMessage(r._status === 200 ? "You're on the updated version. Your progress is kept." : r.reason ?? "Couldn't switch.");
    setCurrent(true);
  }
  return (
    <>
      {update && (
        <div className="notice" role="status">
          <strong>Updated.</strong> A newer version of this lesson (v{update.number}, published {new Date(update.publishedAt).toLocaleDateString()}) is available.
          {update.summary ? ` ${update.summary}` : ""} You&apos;re reading the version you studied.{" "}
          <button type="button" onClick={() => void switchToUpdated()}>Switch to the updated version</button>
        </div>
      )}
      <p className="muted">{data.lesson.course.name}</p>
      <h1>{data.lesson.title}</h1>
      <p className="muted small">Version {v.number}, published {new Date(v.publishedAt).toLocaleDateString()} · Last verified {v.lastVerifiedOn ?? "unknown"}</p>
      <LessonView body={v.body} citations={v.citations} lastVerifiedOn={v.lastVerifiedOn} uncited={v.uncited} />
      {data.progress?.status === "complete"
        ? <p className="muted">Done.</p>
        : <button type="button" onClick={() => void complete()}>Mark as done</button>}
      {message && <p role="status">{message}</p>}
      {practice && <Practice items={practice.activities} score={practice.score} onScore={(score) => setPractice({ ...practice, score })} />}
      <MentorPanel lessonId={id} />
    </>
  );
}
