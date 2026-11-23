import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for integration credentials.
 *
 * AES-256-GCM with a key that lives only in the deployment's environment
 * (INTEGRATIONS_KEY, 64 hex characters). The database holds ciphertext, so
 * a leaked table or backup on its own doesn't hand out anybody's HubSpot
 * token. Rotating the key means reconnecting each integration.
 */

function key(): Buffer {
  const hex = (process.env.INTEGRATIONS_KEY ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("INTEGRATIONS_KEY isn't set (64 hex characters), so credentials can't be stored safely.");
  }
  return Buffer.from(hex, "hex");
}

/** "v1.<iv>.<tag>.<ciphertext>", base64url parts. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("That stored credential is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** A fresh incoming-webhook token, and the hash that is stored for it. */
export function newHookToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
