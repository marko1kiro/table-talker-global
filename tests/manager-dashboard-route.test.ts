import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route", () => {
  it("guards with the manager identity and redirects to login", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain('navigate({ to: "/manager/login" })');
  });
  it("reuses CrewHeader + realtime notices", () => {
    expect(text()).toContain("CrewHeader");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
  });
  it("renders the reminder + log + crew views", () => {
    expect(text()).toContain("buildStaleReminders");
    expect(text()).toContain("groupActiveCrewByStation");
    expect(text()).toContain("reminder");
  });
  it("accumulates a name-less activity log from notices", () => {
    expect(text()).toContain("formatOccupancyNotice");
    expect(text()).toContain("roleLabel");
  });
  it("shows full table status text on desktop (short on mobile)", () => {
    expect(text()).toContain("SIAP DIGUNAKAN");
    expect(text()).toContain("PERLU DIBERSIHKAN");
    expect(text()).toContain("md:hidden");
    expect(text()).toContain("hidden md:flex");
  });
  it("renders active crew as one horizontal table grouped by station", () => {
    expect(text()).toContain("colSpan");
    expect(text()).toContain("Nama Crew");
    expect(text()).toContain("Jam Masuk");
  });
});
