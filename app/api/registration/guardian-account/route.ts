import { registerGuardian } from "@/lib/registration";
import { badRequest } from "@/lib/auth/require-cap";
import { clerkUserId, notConfigured, ownerEmail, readObject, send, unauthorized } from "../session";

// The Guardian's sign-up step, from the invitation email (B3). Body: { adult: true, usResident: true, relationship }.
export async function POST(req: Request) {
  const id = await clerkUserId();
  if (!id) return unauthorized();
  const owner = ownerEmail();
  if (!owner) return notConfigured();
  const body = await readObject(req);
  if (!body) return badRequest("The request body isn't valid JSON.");
  return send(await registerGuardian(id, body, owner));
}
