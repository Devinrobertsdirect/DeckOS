/*
 * crypto.ts — Nobi Cloud security primitives (Node built-ins only, no deps).
 *
 *   1. Password hashing — scrypt (ASYNC, so it never blocks the event loop) with
 *      a per-user random salt. A constant dummy hash lets callers spend identical
 *      time on the "no such user" path (no timing oracle).
 *   2. API-key vault — AES-256-GCM authenticated encryption, bound to the
 *      (accountId, name) slot via AAD so a ciphertext can't be relocated between
 *      slots/accounts even by someone with write access to the store.
 *   3. Tokens — cryptographically random session/link tokens, stored only as
 *      SHA-256 hashes so a store leak can't be replayed.
 *
 * Nothing here logs or returns a secret.
 */
import {
  scrypt as _scrypt,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ── Password hashing (async scrypt) ───────────────────────────────────────────
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 128 * SCRYPT_N * SCRYPT_r * 2 };

/** Hash a plaintext password → `scrypt$N$r$p$saltB64$hashB64`. Never blocks. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Constant-time verify against a stored `scrypt$…` string. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A fixed dummy hash so the login "no such user / no password" branch can spend
// the same scrypt cost as a real verify (defeats the timing-enumeration oracle).
let dummyHashPromise: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("neura-cloud-timing-equalizer");
  return dummyHashPromise;
}

// ── Tokens ────────────────────────────────────────────────────────────────────
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
export function randomId(prefix = ""): string {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

// ── API-key vault (AES-256-GCM, context-bound via AAD) ────────────────────────
const MIN_VAULT_KEY_LEN = 32; // expect hex/base64 of ≥16 random bytes; 32 hex chars = 16 bytes

function masterKey(): Buffer {
  const raw = process.env.NEURA_VAULT_KEY;
  if (!raw || raw.length < MIN_VAULT_KEY_LEN) {
    throw new Error(
      `NEURA_VAULT_KEY is missing or too short (need ≥${MIN_VAULT_KEY_LEN} chars, ideally 64 hex from randomBytes(32)).`,
    );
  }
  return createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a secret → `v1$ivB64$tagB64$cipherB64`.
 * `aad` binds the ciphertext to its slot (e.g. `${accountId}:${name}`): a blob
 * moved to a different slot/account fails the auth-tag check on decrypt.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${iv.toString("base64")}$${tag.toString("base64")}$${enc.toString("base64")}`;
}

/** Decrypt a `v1$…` blob. Throws if tampered, relocated, or the master key changed. */
export function decryptSecret(blob: string, aad: string): string {
  const parts = blob.split("$");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("bad ciphertext format");
  const key = masterKey();
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const enc = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function vaultKeyConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}
