import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression test for a gap found during the Task 10 pre-flight audit:
// RoleLoginFlow's onRoleContinue handed the caller a fully claimed
// RoleSessionIdentity, but src/routes/index.tsx only navigated away with
// it -- it was never persisted via writeRoleSessionIdentity. Kasir/Satgas/
// Clear Up would land on their own route with nothing in storage and
// readRoleSessionIdentity() would always return null there.
const source = () => readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

describe("index.tsx: persists the role session identity before navigating away", () => {
  it("imports writeRoleSessionIdentity from crew-session-identity", () => {
    expect(source()).toContain("writeRoleSessionIdentity");
  });

  it("calls writeRoleSessionIdentity inside onRoleContinue before navigating to the role's route", () => {
    const text = source();
    const start = text.indexOf("onRoleContinue={(identity) => {");
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf("}}", start);
    const handler = text.slice(start, end);
    expect(handler).toContain("writeRoleSessionIdentity(browserSessionStorage(), identity)");
    const writeIndex = handler.indexOf("writeRoleSessionIdentity(");
    const navigateIndex = handler.indexOf("navigate({ to: ROLE_ROUTE_PATH[identity.role] })");
    expect(writeIndex).toBeGreaterThan(-1);
    expect(navigateIndex).toBeGreaterThan(writeIndex);
  });

  it("mirrors the existing SS branch, which persists via writeCrewSessionIdentity the same way", () => {
    const text = source();
    // Formatted across multiple lines by prettier; match whitespace-tolerantly
    // rather than requiring the exact single-line call.
    expect(text).toMatch(
      /writeCrewSessionIdentity\(\s*\n?\s*browserSessionStorage\(\),\s*\n?\s*identity,?\s*\n?\s*\)/,
    );
  });
});
