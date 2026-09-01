import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("shows a desktop help icon linking to /help next to the ready counter", () => {
  const header = source("../src/components/Header.tsx");
  // The desktop help icon is the first `to="/help"` Link in the file (it
  // sits in the top-right icon row next to the ready counter); the mobile
  // banner's own `to="/help"` link comes later. Anchor on the Link element
  // itself rather than a specific surrounding class string, since the
  // wrapper's utility classes have been reordered/extended over time
  // (min-w-0/shrink-0 were added around the original flex/items-center/gap
  // classes) without changing this contract.
  const desktopBlock = header.slice(0, header.indexOf("sm:hidden"));
  expect(desktopBlock).toContain('to="/help"');
  expect(desktopBlock).toContain('aria-label="Butuh bantuan?"');
  expect(desktopBlock).toContain("<LifeBuoy");
  expect(desktopBlock).toContain("sm:flex");
});

it("replaces the mobile banner text with a link to /help", () => {
  const header = source("../src/components/Header.tsx");
  const mobileBanner = header.slice(header.indexOf("sm:hidden"));
  expect(mobileBanner).toContain('to="/help"');
  expect(mobileBanner).toContain("KLIK DISINI");
  expect(mobileBanner).toContain("Jika kamu butuh bantuan atau ada Error");
});

it("gives KLIK DISINI a permanent high-contrast chip instead of relying on hover", () => {
  const header = source("../src/components/Header.tsx");
  const mobileBanner = header.slice(header.indexOf("sm:hidden"));
  const klikDisiniChip = mobileBanner.slice(
    mobileBanner.indexOf("<span"),
    mobileBanner.indexOf("KLIK DISINI") + "KLIK DISINI".length,
  );
  // Chip must use a solid contrasting background, not a hover-only affordance.
  expect(klikDisiniChip).toContain("bg-foreground");
  expect(klikDisiniChip).toContain("text-primary-foreground");
  expect(klikDisiniChip).toContain("brutal-border");
  // hover:underline alone is not a reliable affordance on touch devices.
  expect(mobileBanner).not.toContain("hover:underline");
});

it("keeps the rest of the banner sentence visually secondary to the KLIK DISINI chip", () => {
  const header = source("../src/components/Header.tsx");
  const mobileBanner = header.slice(header.indexOf("sm:hidden"));
  const restOfSentence = mobileBanner.slice(mobileBanner.indexOf("Jika kamu butuh"));
  expect(mobileBanner).toContain("opacity-80");
  expect(restOfSentence.startsWith("Jika kamu butuh")).toBe(true);
});
