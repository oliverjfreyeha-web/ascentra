/** Browser-side API call. Keeps Clerk's reverification hint at the top level so useReverification can see it. */
export type ApiResult = { _status: number; reason?: string } & Record<string, unknown>;

export async function call(method: string, url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...json, _status: res.status };
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");
