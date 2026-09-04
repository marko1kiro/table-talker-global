import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route (TailAdmin)", () => {
  it("keeps core logic intact", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
    expect(text()).toContain("buildStaleNotices");
    expect(text()).toContain("activeStation");
    expect(text()).toContain("formatOccupancyNotice");
  });
  it("uses the TailAdmin shell + primitives + stat cards", () => {
    expect(text()).toContain("ManagerLayout");
    expect(text()).toContain("TaCard");
    expect(text()).toContain("TaStatCard");
    expect(text()).toContain("ToastSlot");
    expect(text()).not.toContain("CrewHeader");
    expect(text()).not.toContain("OwnerUi");
  });
  it("renders the header cluster (emblem, toggle, bell, profile)", () => {
    expect(text()).toContain("RoleEmblem");
    expect(text()).toContain("ThemeToggle");
    expect(text()).toContain("NotificationBell");
    expect(text()).toContain("ProfileMenu");
  });
  it("drops the rotating reminder line but keeps the Perlu Dicek stat", () => {
    expect(text()).not.toContain("rotateIndex");
    expect(text()).not.toContain("buildStaleReminders");
    expect(text()).toContain("Perlu Dicek");
    expect(text()).toContain("TABLE_COUNT");
    expect(text()).toContain("md:grid-cols-10");
  });
});
