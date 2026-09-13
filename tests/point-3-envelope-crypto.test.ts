import { describe, expect, it } from "vitest";
import {
  decryptEnvelope,
  decryptEnvelopeHex,
  encryptEnvelope,
  encryptEnvelopeHex,
} from "../src/lib/app-envelope-crypto.server";
import { encryptPrivateQrExport } from "../src/lib/r2.server";

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 8).toString("base64");
const MAGIC_HEX = "4c494d4551523031"; // "LIMEQR01"

describe("app-envelope-crypto hex envelope", () => {
  it("round-trips a utf8 payload through the hex envelope", () => {
    const envelope = encryptEnvelopeHex("123456", KEY);
    expect(envelope).toMatch(new RegExp(`^${MAGIC_HEX}[0-9a-f]+$`));
    expect(envelope).toMatch(/^[0-9a-f]+$/);
    expect(decryptEnvelopeHex(envelope, KEY)).toBe("123456");
    expect(envelope).not.toContain("313233343536"); // plaintext digits not visible
  });

  it("uses a fresh IV per call (identical plaintexts differ)", () => {
    const a = encryptEnvelopeHex("123456", KEY);
    const b = encryptEnvelopeHex("123456", KEY);
    expect(a).not.toBe(b);
    expect(decryptEnvelopeHex(a, KEY)).toBe(decryptEnvelopeHex(b, KEY));
  });

  it("rejects the wrong key instead of silently passing", () => {
    const envelope = encryptEnvelopeHex("654321", KEY);
    expect(() => decryptEnvelopeHex(envelope, KEY2)).toThrow();
  });

  it("rejects tampering: flipping one hex char in the ciphertext breaks the GCM tag", () => {
    const envelope = encryptEnvelopeHex("123456", KEY);
    const last = envelope.slice(-1) === "0" ? "1" : "0";
    const tampered = `${envelope.slice(0, -1)}${last}`;
    expect(() => decryptEnvelopeHex(tampered, KEY)).toThrow();
  });

  it("rejects a bad magic prefix and truncated envelopes", () => {
    const envelope = encryptEnvelopeHex("123456", KEY);
    expect(() => decryptEnvelopeHex(`00${envelope.slice(2)}`, KEY)).toThrow();
    expect(() => decryptEnvelopeHex(envelope.slice(0, envelope.length - 2), KEY)).toThrow();
    expect(() => decryptEnvelopeHex(MAGIC_HEX, KEY)).toThrow();
  });

  it("fails closed when the env key is missing or malformed", () => {
    const original = process.env.QR_EXPORT_ENCRYPTION_KEY;
    try {
      delete process.env.QR_EXPORT_ENCRYPTION_KEY;
      expect(() => encryptEnvelopeHex("123456")).toThrow();
      process.env.QR_EXPORT_ENCRYPTION_KEY = "not-a-32-byte-base64-key";
      expect(() => encryptEnvelopeHex("123456")).toThrow();
    } finally {
      if (original !== undefined) process.env.QR_EXPORT_ENCRYPTION_KEY = original;
    }
  });

  it("byte API round-trips and matches the r2 QR-export envelope layout", () => {
    const plaintext = new TextEncoder().encode("hello envelope");
    const bytes = encryptEnvelope(plaintext, KEY);
    expect(Buffer.from(decryptEnvelope(bytes, KEY))).toEqual(Buffer.from(plaintext));
    const r2Bytes = encryptPrivateQrExport(plaintext, KEY);
    expect(Buffer.from(r2Bytes).subarray(0, 8)).toEqual(Buffer.from("LIMEQR01", "ascii"));
    expect(Buffer.from(encryptEnvelope(plaintext, KEY)).length).toBeGreaterThanOrEqual(
      MAGIC_HEX.length / 2 + 12 + 16,
    );
  });
});
