import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const indexSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

it("renders the crew message overlay when active", () => {
  expect(indexSource).toContain("useCrewMessage(identityHydrated)");
  expect(indexSource).toContain("CrewMessageOverlay");
  expect(indexSource).toContain("crewMessage.dismiss");
});
