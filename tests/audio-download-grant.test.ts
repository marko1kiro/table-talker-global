import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAudioDownloadGrant,
  verifyAudioDownloadGrant,
} from "../src/lib/audio-download-grant.server";

const NOW = 1_800_000_000_000;
const input = {
  restaurantId: "33916a05-7e95-42fa-bc3c-050bed2402c5",
  audioId: "table:1",
  contentHash: "a".repeat(64),
  byteSize: 1024,
};

let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousSecret;
});

describe("audio download grants", () => {
  it("round-trips trusted immutable object metadata", () => {
    const token = createAudioDownloadGrant(input, NOW);

    expect(verifyAudioDownloadGrant(token, NOW + 1)).toMatchObject(input);
  });

  it("expires after the short download window", () => {
    const token = createAudioDownloadGrant(input, NOW);

    expect(verifyAudioDownloadGrant(token, NOW + 10 * 60 * 1000)).toBeNull();
  });

  it("rejects tampered payloads and signatures", () => {
    const token = createAudioDownloadGrant(input, NOW);
    const [payload, signature] = token.split(".");
    const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyAudioDownloadGrant(`${changedPayload}.${signature}`, NOW)).toBeNull();
    expect(verifyAudioDownloadGrant(`${payload}.${changedSignature}`, NOW)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyAudioDownloadGrant("", NOW)).toBeNull();
    expect(verifyAudioDownloadGrant("one.two.three", NOW)).toBeNull();
    expect(verifyAudioDownloadGrant("not-base64.not-a-signature", NOW)).toBeNull();
  });
});
