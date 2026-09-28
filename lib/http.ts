import "server-only";

const NO_STORE = { "Cache-Control": "no-store" };

export const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export const refuse = (status: number, reason: string) =>
  Response.json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "conflict" : status === 400 ? "invalid_request" : "failed", reason }, { status, headers: NO_STORE });

/** The request body as JSON, or undefined when it isn't JSON. */
export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
