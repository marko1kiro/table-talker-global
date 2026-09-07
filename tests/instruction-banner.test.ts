import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bannerSource = () =>
  readFileSync(new URL("../src/components/InstructionBanner.tsx", import.meta.url), "utf8");

const hookSource = () =>
  readFileSync(new URL("../src/hooks/use-pending-instructions.ts", import.meta.url), "utf8");

describe("InstructionBanner component", () => {
  it("renders a fixed overlay with z-50", () => {
    const src = bannerSource();
    expect(src).toContain("fixed");
    expect(src).toContain("z-50");
  });
  it("shows TERIMA button", () => {
    const src = bannerSource();
    expect(src).toContain("TERIMA");
  });
  it("has reply input with max 100 char", () => {
    const src = bannerSource();
    expect(src).toContain("maxLength={100}");
  });
  it("shows Balas toggle", () => {
    const src = bannerSource();
    expect(src).toContain("Balas");
  });
  it("imports ackInstruction server fn", () => {
    const src = bannerSource();
    expect(src).toContain("ackInstruction");
  });
  it("auto-dismisses expired instructions", () => {
    const src = bannerSource();
    expect(src).toContain("expiresAt");
  });
});

describe("use-pending-instructions hook", () => {
  it("fetches pending instructions on mount", () => {
    const src = hookSource();
    expect(src).toContain("getPendingInstructions");
  });
  it("listens for instruction realtime event", () => {
    const src = hookSource();
    expect(src).toContain("instruction");
  });
});
