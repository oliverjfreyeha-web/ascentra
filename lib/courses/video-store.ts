import "server-only";
import { getDb } from "@/lib/db";

/**
 * C1: the private Supabase Storage bucket for course videos. Files never pass through the app's own server (Vercel
 * limits a request body to 4.5 MB): the Owner's browser uploads straight to Supabase with a one-time signed upload
 * link, and the server then reads only the first bytes back to check what the file really is. Learners get short-lived
 * signed links; the bucket is never public. Kept apart so the tests can stand in for Supabase Storage.
 */
export const VIDEO_BUCKET = "course-videos";

/** A one-time link the browser uploads one file to (valid for 2 hours, Supabase's own limit). */
export async function signUpload(path: string): Promise<{ url: string } | { error: string }> {
  const { data, error } = await getDb().storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "no upload link" };
  return { url: data.signedUrl };
}

/** The file's first bytes and its real size, or null when it isn't there. */
export async function headOf(path: string, n = 64): Promise<{ head: Uint8Array; size: number } | null> {
  const { data, error } = await getDb().storage.from(VIDEO_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${n - 1}` }, cache: "no-store" });
  if (!res.ok) return null;
  const head = new Uint8Array(await res.arrayBuffer()).slice(0, n);
  // "bytes 0-63/52428800": the total after the slash. A server that ignores Range sends the whole file instead.
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  const size = Number.isFinite(total) && total > 0 ? total : Number(res.headers.get("content-length") ?? head.length);
  return { head, size };
}

export async function removeFile(path: string): Promise<void> {
  await getDb().storage.from(VIDEO_BUCKET).remove([path]);
}

/** A link a learner (or the Owner, to preview) can play for `seconds`. */
export async function signDownload(path: string, seconds: number): Promise<string | null> {
  const { data, error } = await getDb().storage.from(VIDEO_BUCKET).createSignedUrl(path, seconds);
  return error || !data?.signedUrl ? null : data.signedUrl;
}
