import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** A new invitation link token (256 bits) and the hash stored in the database. */
export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const isTokenShaped = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
