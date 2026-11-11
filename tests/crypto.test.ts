import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { keyAad, maskKey, openSecret, sealSecret } from "@/lib/crypto";

beforeAll(() => {
  process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
});

describe("key vault", () => {
  const key = "AIzaSyExampleKeyValue1234567890abcdefXYZ";

  it("round-trips a secret", () => {
    const aad = keyAad("user-1", "gemini");
    const sealed = sealSecret(key, aad);
    expect(sealed.ciphertext).not.toContain("AIza");
    expect(openSecret(sealed, aad)).toBe(key);
  });

  it("uses a fresh IV every time", () => {
    const aad = keyAad("user-1", "gemini");
    expect(sealSecret(key, aad).iv).not.toBe(sealSecret(key, aad).iv);
  });

  it("refuses to decrypt for another user or provider", () => {
    const sealed = sealSecret(key, keyAad("user-1", "gemini"));
    expect(() => openSecret(sealed, keyAad("user-2", "gemini"))).toThrow();
    expect(() => openSecret(sealed, keyAad("user-1", "openai"))).toThrow();
  });

  it("detects tampering", () => {
    const aad = keyAad("user-1", "gemini");
    const sealed = sealSecret(key, aad);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 1;
    expect(() => openSecret({ ...sealed, ciphertext: bytes.toString("base64") }, aad)).toThrow();
  });

  it("masks all but four characters on each end", () => {
    expect(maskKey(key)).toBe("AIza••••••••XYZ".replace("XYZ", key.slice(-4)));
    expect(maskKey("short")).toBe("••••••••");
  });
});
