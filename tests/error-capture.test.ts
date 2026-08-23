import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const errorCapture = () =>
  readFileSync(new URL("../src/lib/error-capture.ts", import.meta.url), "utf8");

it("imports reportOperationalError from server", () => {
  expect(errorCapture()).toContain('import { reportOperationalError }');
});

it("exports captureError, consumeLastCapturedError, and captureSsrError", () => {
  const source = errorCapture();
  expect(source).toContain("export async function captureError");
  expect(source).toContain("export function consumeLastCapturedError");
  expect(source).toContain("export function captureSsrError");
});

it("defines error stages", () => {
  const source = errorCapture();
  expect(source).toContain("tenant_login");
  expect(source).toContain("sync_cache");
  expect(source).toContain("playback");
  expect(source).toContain("realtime");
  expect(source).toContain("rpc");
  expect(source).toContain("server");
});

it("truncates detail to 1000 chars", () => {
  expect(errorCapture()).toContain(".slice(0, 1000)");
});
