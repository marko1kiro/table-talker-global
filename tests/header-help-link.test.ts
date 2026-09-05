import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// SP3: the TailAdmin header keeps a single always-visible help icon-link to
// /help (the old brutal mobile "KLIK DISINI" banner was removed).
it("shows a help icon linking to /help", () => {
  const header = source("../src/components/Header.tsx");
  expect(header).toContain('to="/help"');
  expect(header).toContain('aria-label="Butuh bantuan?"');
  expect(header).toContain("<LifeBuoy");
});

it("drops the brutal mobile help banner", () => {
  const header = source("../src/components/Header.tsx");
  expect(header).not.toContain("KLIK DISINI");
  expect(header).not.toContain("brutal-border");
});
