// Poin 6.1 S6: source-scan locks (pola tests/point-6-read-transport.test.ts).
// These read SOURCE TEXT on purpose: they fail when someone quietly removes a
// mandated behavior that runtime tests could also miss (old-tab regressions).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const flow = readFileSync("src/components/CrewLoginFlow.tsx", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");
const update = readFileSync("src/components/UpdatePrompt.tsx", "utf8");
const updateLib = readFileSync("src/lib/update-prompt.ts", "utf8");

describe("crew login flow (Poin 6.1)", () => {
  test("the magic-link-era button is gone", () => {
    expect(flow).not.toMatch(/Sudah punya kode/i);
  });
  test("pairing keeps its own OTP state", () => {
    expect(flow).toMatch(/otpPairing/);
  });
  test("setPassword gate is mandatory (updateUser path wired)", () => {
    expect(flow).toMatch(/crewSetPassword/);
    expect(flow).toMatch(/crewLoginMethod/);
    expect(flow).toMatch(/crewSignInWithPassword/);
  });
  test("login copy stays exactly as approved", () => {
    expect(flow).toContain("Email atau password salah.");
    expect(flow).toContain("Password minimal 6 karakter.");
    expect(flow).toContain("Ulangi password belum sama.");
  });
});

describe("retry mechanism (live-state)", () => {
  test("retry uses live state dispatch, not stale closures", () => {
    expect(flow).toMatch(/RetryAction/);
    expect(flow).not.toMatch(/setRetryable/);
  });
});

describe("copy (review fixes)", () => {
  test("throttle copy uses approved strings", () => {
    expect(flow).toContain("Terlalu sering mencoba masuk. Tunggu sebentar lalu coba lagi.");
    expect(flow).toContain("Terlalu sering mencoba. Tunggu sekitar 15 menit lalu coba lagi.");
  });
});

describe("no test-infra creep", () => {
  test("jest-dom is never re-introduced", () => {
    expect(readFileSync("package.json", "utf8")).not.toMatch(/jest-dom/);
    expect(readFileSync("vitest.config.ts", "utf8")).not.toMatch(/setup-jest-dom/);
  });
});

describe("root shell", () => {
  test("Toaster + UpdatePrompt mounted for ALL roles", () => {
    expect(root).toMatch(/<Toaster/);
    expect(root).toMatch(/<UpdatePrompt/);
  });
  test("prompt copy is the owner's exact string", () => {
    expect(updateLib).toContain("Ada Update sistem, Tolong refresh halaman ya.");
    expect(update).toMatch(/UPDATE_TEXT/);
  });
});
