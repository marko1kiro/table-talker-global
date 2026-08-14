import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createSessionStorageAdapter } from "../src/lib/crew-session-identity";

const source = readFileSync(new URL("../src/lib/supabase-browser.ts", import.meta.url), "utf8");

it("uses the safe sessionStorage auth adapter with persistence and refresh enabled", () => {
  expect(source).toContain("createSessionStorageAdapter(browserSessionStorage())");
  expect(source).toContain("persistSession: true");
  expect(source).toContain("autoRefreshToken: true");
});

it("returns null rather than throwing for unavailable browser storage", () => {
  const adapter = createSessionStorageAdapter(null);
  expect(adapter.getItem("supabase.auth.token")).toBeNull();
  expect(() => adapter.setItem("supabase.auth.token", "token")).not.toThrow();
  expect(() => adapter.removeItem("supabase.auth.token")).not.toThrow();
});
