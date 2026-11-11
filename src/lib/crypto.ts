import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealing for provider API keys.
 *
 * - The master secret lives only in the environment (KEY_ENCRYPTION_SECRET),
 *   never in the database.
 * - The additional authenticated data (AAD) binds a ciphertext to its owner and
 *   provider, so copying a row to another user makes decryption fail.
 */

export interface Sealed {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

function masterKey(): Buffer {
  const b64 = process.env.KEY_ENCRYPTION_SECRET;
  if (!b64) throw new Error("KEY_ENCRYPTION_SECRET is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("KEY_ENCRYPTION_SECRET must be 32 random bytes, base64-encoded");
  }
  return key;
}

export function sealSecret(plain: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(sealed: Sealed, aad: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/** Display-safe version of a key: first 4 and last 4 characters only. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return "••••••••";
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

export function keyAad(userId: string, provider: string): string {
  return `${userId}:${provider}`;
}
