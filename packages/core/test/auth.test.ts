import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, checkPassword, hashPassword, newTotpSecret, totpAt, verifyPassword, verifyTotp } from "../src/server";

describe("sign-in helpers", () => {
  it("matches the RFC 6238 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 59_000)).toBe("287082");
    expect(totpAt(secret, 1111111109_000)).toBe("081804");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("accepts the current code and allows a little clock drift, nothing more", () => {
    const s = newTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpAt(s, now), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "abc123", now)).toBe(false);
  });

  it("hashes passwords and checks them", () => {
    const h = hashPassword("a long enough passphrase");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("a long enough passphrase", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(hashPassword("same") === hashPassword("same")).toBe(false);
  });

  it("explains weak passwords in plain words", () => {
    expect(checkPassword("short")).toMatch(/12 characters/);
    expect(checkPassword("maria-is-the-best-nurse", "maria@bayside.example")).toMatch(/email/);
    expect(checkPassword("password12345")).toMatch(/harder/);
    expect(checkPassword("violet harbor lantern")).toBeNull();
  });
});
