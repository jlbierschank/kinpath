/**
 * Two-step sign-in codes (TOTP, RFC 6238): the 6-digit codes from Google Authenticator,
 * 1Password, Microsoft Authenticator and similar apps. Also one-time sign-in codes and
 * password rules. Uses only Node's built-in crypto.
 */
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, time: number, step = 30): string {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side, for clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totpAt(secret, now + w * 30_000), c));
}

export const otpauthUri = (secret: string, account: string, issuer = "Pumpkin") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- passwords ----------
const N = 16384, R = 8, P = 1, LEN = 32;
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const h = scryptSync(pw, Buffer.from(salt, "base64"), LEN, { N: Number(n), r: Number(r), p: Number(p) });
  return safeEqual(h.toString("base64"), hash);
}
/** Plain-language reason a password isn't acceptable, or null. */
export function checkPassword(pw: string, email = ""): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (email && pw.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Don't include your email name in your password.";
  if (/^(.)\1+$/.test(pw) || /^(password|123456|qwerty)/i.test(pw)) return "Choose something harder to guess.";
  return null;
}

// ---------- one-time codes and tokens ----------
export const newSignInCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
