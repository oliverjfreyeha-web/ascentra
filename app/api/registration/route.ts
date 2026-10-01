import { register, registrationState } from "@/lib/registration";
import { badRequest } from "@/lib/auth/require-cap";
import { ok } from "@/lib/http";
import { clerkUserId, notConfigured, ownerEmail, readObject, send, unauthorized } from "./session";

// The sign-up step (B2). GET: where this Clerk user stands. POST { dateOfBirth, usResident }: create the account.
export async function GET() {
  const id = await clerkUserId();
  if (!id) return unauthorized();
  const owner = ownerEmail();
  if (!owner) return notConfigured();
  return ok(await registrationState(id, owner));
}

export async function POST(req: Request) {
  const id = await clerkUserId();
  if (!id) return unauthorized();
  const owner = ownerEmail();
  if (!owner) return notConfigured();
  const body = await readObject(req);
  if (!body) return badRequest("The request body isn't valid JSON.");
  return send(await register(id, body, owner));
}
