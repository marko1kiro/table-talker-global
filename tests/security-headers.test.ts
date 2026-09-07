import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VERCEL_PATH = join(process.cwd(), "vercel.json");

describe("security headers", () => {
  let config: Record<string, unknown>;

  beforeAll(() => {
    config = JSON.parse(readFileSync(VERCEL_PATH, "utf8"));
  });

  it("has headers configuration", () => {
    expect(config.headers).toBeDefined();
    expect(Array.isArray(config.headers)).toBe(true);
  });

  it("sets X-Frame-Options to DENY", () => {
    const headers = config.headers as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const xFrame = headers.flatMap((h) => h.headers).find((h) => h.key === "X-Frame-Options");
    expect(xFrame?.value).toBe("DENY");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const headers = config.headers as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const xcto = headers.flatMap((h) => h.headers).find((h) => h.key === "X-Content-Type-Options");
    expect(xcto?.value).toBe("nosniff");
  });

  it("sets Referrer-Policy", () => {
    const headers = config.headers as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const rp = headers.flatMap((h) => h.headers).find((h) => h.key === "Referrer-Policy");
    expect(rp?.value).toBeTruthy();
  });

  it("sets Permissions-Policy", () => {
    const headers = config.headers as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const pp = headers.flatMap((h) => h.headers).find((h) => h.key === "Permissions-Policy");
    expect(pp?.value).toBeTruthy();
  });
});
