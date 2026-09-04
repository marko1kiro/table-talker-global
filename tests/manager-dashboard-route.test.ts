import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route (TailAdmin)", () => {
  it("keeps all core logic intact", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
    expect(text()).toContain("buildStaleReminders");
    expect(text()).toContain("activeStation");
    expect(text()).toContain("formatOccupancyNotice");
  });
  it("uses the TailAdmin shell + primitives + stat cards", () => {
    expect(text()).toContain("ManagerLayout");
    expect(text()).toContain("TaCard");
    expect(text()).toContain("TaStatCard");
    expect(text()).not.toContain("CrewHeader");
    expect(text()).not.toContain("OwnerUi");
  });
  it("keeps the reminder banner + full table grid", () => {
    expect(text()).toContain("reminder");
    expect(text()).toContain("TABLE_COUNT");
    expect(text()).toContain("md:grid-cols-10");
  });
});
