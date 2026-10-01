import { inviteGuardian } from "@/lib/registration";
import { badRequest } from "@/lib/auth/require-cap";
import { clerkUserId, readObject, send, unauthorized } from "../session";

// A teen waiting for their Guardian names the Guardian's email (B2: stored as an invitation; B3 sends it).
export async function POST(req: Request) {
  const id = await clerkUserId();
  if (!id) return unauthorized();
  const body = await readObject(req);
  if (!body) return badRequest("The request body isn't valid JSON.");
  return send(await inviteGuardian(id, body));
}
