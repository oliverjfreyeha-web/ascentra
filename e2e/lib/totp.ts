import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 authenticator codes for test users (30-second steps, 6 digits, SHA-1), as an authenticator app computes them.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g)!.map((c) => ALPHABET[parseInt(c.padEnd(5, "0"), 2)]).join("");
}

function base32(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Waits until the current code has at least `min` seconds left, so it doesn't expire mid-entry. */
export async function freshTotp(secret: string, min = 8): Promise<string> {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < min) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  return totp(secret);
}
