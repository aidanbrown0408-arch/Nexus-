import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

// Symmetric encryption for secrets we have to store and read back —
// currently just the Apple app-specific password. Google tokens don't go
// through here: they're OAuth tokens the user can revoke from Google's
// side, and they expire. An Apple app-specific password does neither, so
// it gets encrypted at rest rather than sitting in a column in plaintext.
//
// AES-256-GCM, so a tampered ciphertext fails to decrypt rather than
// decrypting to garbage we'd then send to Apple.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;
const VERSION = "v1";

// Accepts base64 or hex so it doesn't matter which one the user's key
// generator spat out. Must decode to exactly 32 bytes either way.
function getKey(): Buffer {
  const raw = process.env.APPLE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APPLE_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }

  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_BYTES * 2) {
    candidates.push(Buffer.from(raw, "hex"));
  }
  candidates.push(Buffer.from(raw, "base64"));

  const key = candidates.find((b) => b.length === KEY_BYTES);
  if (!key) {
    throw new Error(
      "APPLE_ENCRYPTION_KEY must decode to 32 bytes (base64 or hex). Generate one with: openssl rand -base64 32"
    );
  }
  return key;
}

// Returns "v1:<iv>:<authTag>:<ciphertext>", all base64. The version
// prefix is there so a future key rotation or algorithm change can
// recognize old rows instead of guessing at them.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Stored secret is not in the expected format");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// Whether the configured key can actually be loaded. Routes call this to
// fail with a clear "not configured" message at connect time instead of
// throwing deep inside an encrypt call.
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

// Constant-time compare, for anywhere we check a secret against a stored
// value. Length is not secret here, so an early return on mismatched
// lengths is fine.
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
