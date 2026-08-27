import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("suppresses stale preview callbacks and resets visible request state", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/broadcast.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("const previewRequestId = useRef(0)");
  expect(source).toContain("const requestId = ++previewRequestId.current");
  expect(source).toContain("if (requestId !== previewRequestId.current) return;");
  expect(source).toContain("setResult(null);");
  expect(source).toContain('setError("");');
});
