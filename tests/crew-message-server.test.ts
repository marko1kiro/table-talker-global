import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../src/lib/remote-audio.server.ts", import.meta.url), "utf8");

it("exports sendCrewMessage server fn bound to create_crew_message RPC", () => {
  expect(source).toContain("sendCrewMessage");
  expect(source).toContain("create_crew_message");
  expect(source).toContain("requireSuperAdmin");
});
