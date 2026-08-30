import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("ships all five owner sections without remote soundboard controls", () => {
  for (const path of [
    "index.tsx",
    "restaurants/index.tsx",
    "audio.tsx",
    "history.tsx",
    "error-log.tsx",
  ]) {
    expect(file(`src/routes/super-admin/${path}`)).toContain("createFileRoute");
  }
  const layout = file("src/routes/super-admin/route.tsx");
  expect(layout).toContain("getAuthStatus");
  expect(layout).not.toContain("requireSuperAdmin");
  expect(layout).not.toContain("SoundboardGrid");
});

it("keeps owner service credentials out of browser routes", () => {
  for (const path of [
    "index.tsx",
    "restaurants/index.tsx",
    "audio.tsx",
    "history.tsx",
    "error-log.tsx",
  ]) {
    expect(file(`src/routes/super-admin/${path}`)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  }
});
