import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const CIPHERTEXT_ERROR = "INVALID_CREDENTIAL_CIPHERTEXT";
const FORMAT = "aes-256-gcm:v1";

export type RestaurantCodeEncryptionKey = Buffer;

function decodeBase64url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_RESTAURANT_CODE_ENCRYPTION_KEY");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("INVALID_RESTAURANT_CODE_ENCRYPTION_KEY");
  return decoded;
}

function deriveKey(baseKey: RestaurantCodeEncryptionKey, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", baseKey, Buffer.alloc(0), Buffer.from(purpose), 32));
}

function aad(restaurantId: string): Buffer {
  return Buffer.from(`restaurant_id:${restaurantId};format:${FORMAT}`);
}

function invalidCiphertext(): never {
  throw new Error(CIPHERTEXT_ERROR);
}

export function parseRestaurantCodeEncryptionKey(value: string): RestaurantCodeEncryptionKey {
  const key = decodeBase64url(value);
  if (key.length !== 32) throw new Error("INVALID_RESTAURANT_CODE_ENCRYPTION_KEY");
  return key;
}

export function hashRestaurantCode(code: string, baseKey: RestaurantCodeEncryptionKey): string {
  const lookupKey = deriveKey(baseKey, "restaurant-code-lookup:v1");
  const digest = createHmac("sha256", lookupKey).update(code).digest("base64url");
  return `hmac-sha256:v1:${digest}`;
}

export function encryptRestaurantCode(
  code: string,
  restaurantId: string,
  baseKey: RestaurantCodeEncryptionKey,
): string {
  const encryptionKey = deriveKey(baseKey, "restaurant-code-encryption:v1");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(aad(restaurantId));
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT}:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${tag.toString("base64url")}`;
}

export function decryptRestaurantCode(
  value: string,
  restaurantId: string,
  baseKey: RestaurantCodeEncryptionKey,
): string {
  try {
    const [algorithm, version, nonceValue, ciphertextValue, tagValue] = value.split(":");
    if (algorithm !== "aes-256-gcm" || version !== "v1" || !nonceValue || !ciphertextValue || !tagValue)
      return invalidCiphertext();
    const nonce = decodeBase64url(nonceValue);
    const ciphertext = decodeBase64url(ciphertextValue);
    const tag = decodeBase64url(tagValue);
    if (nonce.length !== 12 || tag.length !== 16) return invalidCiphertext();

    const encryptionKey = deriveKey(baseKey, "restaurant-code-encryption:v1");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
    decipher.setAAD(aad(restaurantId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return invalidCiphertext();
  }
}

function isCredentialField(key: string): boolean {
  return /^(code|code_hash|code_encrypted|credential|token|authorization|.*(?:token|bearer).*)$/i.test(key);
}

export function redactCredentialAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentialAudit);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      isCredentialField(key) ? [] : [[key, redactCredentialAudit(entry)]],
    ),
  );
}
