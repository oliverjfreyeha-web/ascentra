/** Browser-side API call. Keeps Clerk's reverification hint at the top level so useReverification can see it. */
export type ApiResult = { _status: number; reason?: string } & Record<string, unknown>;

/** Sent after this browser's device check runs again, so the device gate (app/device-gate.tsx) can refresh. */
export const DEVICE_EVENT = "ascentra:device";

async function once(method: string, url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...json, _status: res.status };
}

/**
 * R1: a page can ask the API for something before this browser has been registered as a trusted device (right after
 * sign-up or a first sign-in, the device check and the page start together). When the API says the device isn't
 * trusted, run the device check once (it adds the browser while a slot is free), tell the device gate, and retry
 * once. If all slots are in use the device gate shows the replace screen; the answer here stays the refusal.
 */
export async function call(method: string, url: string, body?: unknown): Promise<ApiResult> {
  const r = await once(method, url, body);
  if (r._status !== 403 || r.error !== "device_not_trusted" || url.startsWith("/api/v1/session")) return r;
  const check = await once("POST", "/api/v1/session").catch(() => null);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEVICE_EVENT));
  const trusted = !!check && check._status === 200 && (check.device as { trusted?: boolean } | null)?.trusted === true;
  return trusted ? once(method, url, body) : r;
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * S1: a device's date and time, or only the date when the time isn't known: a date-only value ("2026-10-01"), or one at
 * exactly midnight (00:00:00.000, local or UTC), which is how a day without a time is stored. Never "12:00:00 AM".
 */
export function whenKnown(iso: string | null | undefined, locale?: string, timeZone?: string): string {
  if (!iso) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  const local = new Date(d.toLocaleString("en-US", { timeZone }));
  const localMidnight = local.getHours() === 0 && local.getMinutes() === 0 && local.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (dateOnly || utcMidnight) return d.toLocaleDateString(locale, { timeZone: "UTC" });
  if (localMidnight) return d.toLocaleDateString(locale, { timeZone });
  return d.toLocaleString(locale, { timeZone });
}
