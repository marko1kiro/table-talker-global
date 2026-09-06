import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager header logo (desktop)", () => {
  it("AppShell menampilkan logo di semua breakpoint saat headerTitle tidak dikirim", () => {
    const shell = read("../src/components/dashboard/AppShell.tsx");
    expect(shell).toContain("headerTitle?: string");
    expect(shell).toContain("headerLogo && !headerTitle");
  });

  it("ManagerLayout tidak lagi mengirim headerTitle (logo menggantikan teks menu)", () => {
    const layout = read("../src/components/ManagerLayout.tsx");
    expect(layout).not.toContain("headerTitle");
  });

  it("Kasir tetap memakai headerTitle (tidak berubah)", () => {
    const kasir = read("../src/routes/kasir/index.tsx");
    expect(kasir).toContain('headerTitle="Status Meja"');
  });
});
