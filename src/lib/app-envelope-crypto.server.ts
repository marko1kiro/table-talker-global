// Shared AES-256-GCM envelope codec (Poin 3, Task 6). Extracted verbatim from
// r2.server.ts so the private QR-export archives and the crew pairing OTP
// envelope (crew-auth.server.ts) share ONE implementation and the same
// QR_EXPORT_ENCRYPTION_KEY. Wire format: magic "LIMEQR01" (8B) + IV (12B) +
// GCM auth tag (16B) + ciphertext. Hex helpers wrap the byte codec for the
// text columns (crew_pairing_requests.otp_encrypted stores lowercase hex and
// its CHECK enforces the ^4c494d4551523031 prefix).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_MAGIC = Buffer.from("LIMEQR01", "ascii");
const ENVELOPE_IV_BYTES = 12;
const ENVELOPE_TAG_BYTES = 16;

function envelopeKey(encodedKey = process.env.QR_EXPORT_ENCRYPTION_KEY ?? ""): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("Kunci enkripsi aplikasi belum dikonfigurasi dengan benar.");
  }
  return key;
}

export function encryptEnvelope(body: Uint8Array | string, encodedKey?: string): Uint8Array {
  const plaintext = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const iv = randomBytes(ENVELOPE_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", envelopeKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), ciphertext]));
}

export function decryptEnvelope(body: Uint8Array, encodedKey?: string): Uint8Array {
  const envelope = Buffer.from(body);
  const headerBytes = ENVELOPE_MAGIC.byteLength + ENVELOPE_IV_BYTES + ENVELOPE_TAG_BYTES;
  if (
    envelope.byteLength < headerBytes ||
    !envelope.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC)
  ) {
    throw new Error("Data terenkripsi tidak valid.");
  }
  const ivStart = ENVELOPE_MAGIC.byteLength;
  const tagStart = ivStart + ENVELOPE_IV_BYTES;
  const dataStart = tagStart + ENVELOPE_TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    envelopeKey(encodedKey),
    envelope.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(envelope.subarray(tagStart, dataStart));
  return new Uint8Array(
    Buffer.concat([decipher.update(envelope.subarray(dataStart)), decipher.final()]),
  );
}

export function encryptEnvelopeHex(plaintextUtf8: string, encodedKey?: string): string {
  return Buffer.from(encryptEnvelope(plaintextUtf8, encodedKey)).toString("hex");
}

export function decryptEnvelopeHex(envelopeHex: string, encodedKey?: string): string {
  return Buffer.from(decryptEnvelope(Buffer.from(envelopeHex, "hex"), encodedKey)).toString("utf8");
}
