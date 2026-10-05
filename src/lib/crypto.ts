// Field-level encryption for pickup addresses, access notes and phone numbers (AES-256-GCM via node:crypto).
// The key is derived (HKDF-SHA256) from PICKUP_ENCRYPTION_KEY. Each value gets a fresh random 96-bit IV, and the
// owning row id is bound in as additional authenticated data so a ciphertext cannot be copied onto another row.
// Format: "v1.<iv>.<tag>.<ciphertext>", all base64url.
import crypto from "node:crypto";
import { config } from "./config";

const VERSION = "v1";
let cached: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const secret = config.pickupEncryptionSecret;
  if (!cached || cached.secret !== secret) {
    cached = { secret, key: Buffer.from(crypto.hkdfSync("sha256", secret, "openframe-pickup-salt", "openframe-pickup-v1", 32)) };
  }
  return cached.key;
}

export function encryptField(plain: string, aad: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptField(blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unrecognised ciphertext format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
