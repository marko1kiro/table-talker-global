import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateRestaurantCode } from "../src/lib/restaurant-domain";
import {
  decryptRestaurantCode,
  encryptRestaurantCode,
  hashRestaurantCode,
  parseRestaurantCodeEncryptionKey,
  redactCredentialAudit,
} from "../src/lib/restaurant-code.server";

const code = (suffix = "") => `${"A".repeat(6 - suffix.length)}${suffix}`;
const key = Buffer.alloc(32, 7).toString("base64url");
const restaurantId = "00000000-0000-4000-8000-000000000001";

it("accepts exact uppercase ASCII codes from six through thirty-two characters", () => {
  expect(validateRestaurantCode(code())).toEqual({ code: code() });
  expect(validateRestaurantCode("A".repeat(32))).toEqual({ code: "A".repeat(32) });
});

it("rejects transformed and malformed values without returning input", () => {
  for (const value of [
    "a".repeat(6),
    ` ${code()}`,
    `${code()} `,
    "A".repeat(5),
    "A".repeat(33),
    "A-BBBB",
    "A_BBBB",
    "AＡBBBB",
    "",
  ]) {
    expect(validateRestaurantCode(value)).toEqual({ error: "Kode Resto salah." });
  }
});

it("derives deterministic keyed lookup hashes with separate purposes", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  expect(hashRestaurantCode(code(), parsed)).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/);
  expect(hashRestaurantCode(code(), parsed)).toBe(hashRestaurantCode(code(), parsed));
  expect(hashRestaurantCode(`${code()}A`, parsed)).not.toBe(hashRestaurantCode(code(), parsed));
  expect(
    hashRestaurantCode(
      code(),
      parseRestaurantCodeEncryptionKey(Buffer.alloc(32, 8).toString("base64url")),
    ),
  ).not.toBe(hashRestaurantCode(code(), parsed));
});

it("uses versioned Table Talker HKDF purposes while reading pilot v1 ciphertext", () => {
  const source = readFileSync(
    new URL("../src/lib/restaurant-code.server.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("table-talker/restaurant-code-lookup/v1");
  expect(source).toContain("table-talker/restaurant-code-encryption/v1");
  expect(source).toContain("restaurant-code-encryption:v1");
});

it("encrypts with fresh nonce and authenticates restaurant identity", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  const first = encryptRestaurantCode(code(), restaurantId, parsed);
  const second = encryptRestaurantCode(code(), restaurantId, parsed);
  expect(first).toMatch(/^aes-256-gcm:v1:/);
  expect(first).not.toBe(second);
  expect(decryptRestaurantCode(first, restaurantId, parsed)).toBe(code());
  expect(() =>
    decryptRestaurantCode(first, "00000000-0000-4000-8000-000000000002", parsed),
  ).toThrow("INVALID_CREDENTIAL_CIPHERTEXT");
});

it("rejects malformed, unsupported, and tampered ciphertext without credential disclosure", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  const encrypted = encryptRestaurantCode(code(), restaurantId, parsed);
  const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");
  for (const value of ["aes-256-gcm:v2:x:y:z", tampered, "bad"]) {
    expect(() => decryptRestaurantCode(value, restaurantId, parsed)).toThrow(
      "INVALID_CREDENTIAL_CIPHERTEXT",
    );
  }
  expect(
    JSON.stringify(
      redactCredentialAudit({
        code: code(),
        code_hash: "hash",
        code_encrypted: "cipher",
        reason: "failed",
      }),
    ),
  ).toBe('{"reason":"failed"}');
});
