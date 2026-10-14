import Link from "next/link";
import { ImportPage } from "./import-page";
import "./import.css";

export default function ImportCoursePage() {
  return (
    <main className="wide ui-admin">
      <p className="muted"><Link href="/">Home</Link> · <Link href="/admin">Admin</Link> · <Link href="/admin/topics">Topics</Link> · <Link href="/admin/review">Owner review</Link></p>
      <h1>Import course</h1>
      <div className="import__about">
        <p>
          Paste or choose one finished course file (JSON, 2 MB at most): format version 1 for a business or side hustle, format version 2
          for a skill track (one Round or all three). <strong>Check file</strong> is a dry run that
          lists every problem with its place in the file and what would be created. <strong>Create Draft</strong> then makes a new Draft
          version of the topic&apos;s course: lessons, practice items, video slots waiting for video, sources, the capstone and notices.
          Nothing is published or approved: the course goes through the usual review, a Reviewer&apos;s verification and your approval of
          each module.
        </p>
        <p className="small muted">
          The file names an existing topic (<code>topicSlug</code>). A business or side hustle must have no published course; a skill track
          always becomes a new Draft version, and a published Round is never changed. Every item needs a source and an
          importance label; every text field is checked for income claims and &ldquo;attorney approved&rdquo; wording. The full format and a fake
          sample file are in <code>docs/COURSE-IMPORT.md</code> in the repository.
        </p>
      </div>
      <ImportPage />
    </main>
  );
}
