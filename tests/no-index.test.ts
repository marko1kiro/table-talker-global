import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const robots = () => readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
const root = () => readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");

describe("no-index policy (block all crawlers)", () => {
  it("robots.txt disallows every user-agent across the whole site", () => {
    const s = robots();
    expect(s).toContain("User-agent: *");
    expect(s).toContain("Disallow: /");
    expect(s).not.toContain("Allow: /");
    expect(s.toLowerCase()).not.toContain("sitemap:");
  });
  it("every page inherits a global noindex, nofollow robots meta", () => {
    expect(root()).toContain('{ name: "robots", content: "noindex, nofollow" }');
  });
});
