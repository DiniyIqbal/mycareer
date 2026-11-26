import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Secret link tokens (invitations, data-request verification, export
 * downloads): 256 random bits in the URL, only the SHA-256 in the database.
 */
export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const isTokenShaped = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
