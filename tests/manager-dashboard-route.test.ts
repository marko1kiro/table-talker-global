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
  it("lists ALL tables (1..TABLE_COUNT), not just occupied ones", () => {
    expect(text()).toContain("TABLE_COUNT");
    expect(text()).toContain("Array.from");
  });
  it("accumulates a name-less activity log from notices", () => {
    expect(text()).toContain("formatOccupancyNotice");
    expect(text()).toContain("roleLabel");
  });
  it("shows only the table number on desktop, 10 per row, no cell border", () => {
    expect(text()).toContain("md:grid-cols-10");
    expect(text()).toContain("md:border-0");
    expect(text()).toContain("hidden md:grid");
    expect(text()).toContain("md:hidden");
    expect(text()).not.toContain("SIAP DIGUNAKAN");
    expect(text()).not.toContain("PERLU DIBERSIHKAN");
  });
  it("renders active crew as one horizontal table, uppercase names, per-role header bg", () => {
    expect(text()).toContain("colSpan");
    expect(text()).toContain("Nama Crew");
    expect(text()).toContain("Jam Masuk");
    expect(text()).toContain("font-bold uppercase");
    expect(text()).toContain("bg-sky-500");
    expect(text()).toContain("bg-amber-500");
    expect(text()).toContain("bg-violet-500");
    expect(text()).toContain("bg-emerald-500");
  });
  it("uses a stronger but still thin divider in the activity log", () => {
    expect(text()).toContain("divide-slate-300");
  });
});
