import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = () =>
  readFileSync(new URL("../src/components/ManagerLayout.tsx", import.meta.url), "utf8");

const routeSource = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("ManagerLayout PESAN menu", () => {
  it("includes messages in ManagerMenu type", () => {
    const src = layoutSource();
    expect(src).toContain('"messages"');
  });
  it("has KIRIM INSTRUKSI label with MessageSquare icon", () => {
    const src = layoutSource();
    expect(src).toContain("KIRIM INSTRUKSI");
    expect(src).toContain("MessageSquare");
  });
});

describe("Manager dashboard messages tab", () => {
  it("imports sendManagerInstruction and getInstructionThread", () => {
    const src = routeSource();
    expect(src).toContain("sendManagerInstruction");
    expect(src).toContain("getInstructionThread");
  });
  it("renders compose area with send button", () => {
    const src = routeSource();
    expect(src).toContain("KIRIM INSTRUKSI");
    expect(src).toContain("maxLength={200}");
  });
  it("renders target selector (SEMUA CREW or individual)", () => {
    const src = routeSource();
    expect(src).toContain("SEMUA CREW");
  });
  it("shows ACK status", () => {
    const src = routeSource();
    expect(src).toContain("ackAt");
  });
  it("subscribes to instruction_ack realtime event", () => {
    const src = routeSource();
    expect(src).toContain("instruction_ack");
  });
});
