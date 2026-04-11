import { commsEncryptToken, commsDecryptToken } from "@/lib/comms-crypto";

describe("comms-crypto", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // 32 bytes = 64 hex chars
    process.env.COMMS_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("encrypts and decrypts a token round-trip", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token";
    const encrypted = commsEncryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);
    const decrypted = commsDecryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("returns empty string for empty input", () => {
    expect(commsEncryptToken("")).toBe("");
    expect(commsDecryptToken("")).toBe("");
  });

  test("returns plaintext if no encryption key is set", () => {
    delete process.env.COMMS_TOKEN_ENCRYPTION_KEY;
    const token = "test-token";
    expect(commsEncryptToken(token)).toBe(token);
    expect(commsDecryptToken(token)).toBe(token);
  });

  test("throws if encryption key is wrong length", () => {
    process.env.COMMS_TOKEN_ENCRYPTION_KEY = "tooshort";
    expect(() => commsEncryptToken("test")).toThrow("32 bytes");
  });

  test("different encryptions of same plaintext produce different ciphertext", () => {
    const token = "same-token";
    const a = commsEncryptToken(token);
    const b = commsEncryptToken(token);
    expect(a).not.toBe(b); // random IV each time
  });
});
