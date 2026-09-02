import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Sweep efisiensi Super Admin: minim scroll via tabel padat + default domain
// QR resmi. Kontrak logika semua halaman tidak berubah (filter, pagination,
// mutasi, dialog).

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("QR export defaults to the official qris-order.lihatmeja.com domain", () => {
  const server = read("../src/lib/qr-export.server.ts");
  expect(server).toContain(
    'export const DEFAULT_QR_EXPORT_DOMAIN = "https://qris-order.lihatmeja.com";',
  );
  expect(server).not.toContain("xdirga.xyz");
});

it("R2 public fallback uses static.lihatmeja.com, not the deleted legacy domain", () => {
  const r2 = read("../src/lib/r2.server.ts");
  expect(r2).toContain('"https://static.lihatmeja.com"');
  expect(r2).not.toContain("static.xdirga.xyz");
});

it("esb-export renders QR history as a table", () => {
  const page = read("../src/routes/super-admin/esb-export.tsx");
  expect(page).toContain('from "@/components/ui/table"');
  expect(page).toContain("<Table>");
  expect(page).not.toContain('className="space-y-3"');
});

it("history page renders activity rows as a table", () => {
  const page = read("../src/routes/super-admin/history.tsx");
  expect(page).toContain('from "@/components/ui/table"');
  expect(page).toContain("<Table>");
  expect(page).not.toContain("<article");
});

it("error log renders incidents as a compact table", () => {
  const page = read("../src/routes/super-admin/error-log.tsx");
  expect(page).toContain('from "@/components/ui/table"');
  expect(page).toContain("<Table>");
  expect(page).toContain("row.report_code");
  expect(page).toContain("resolveOperationalError");
});

it("audio catalog renders as a table with inline actions", () => {
  const page = read("../src/routes/super-admin/audio.tsx");
  expect(page).toContain('from "@/components/ui/table"');
  expect(page).toContain("<Table>");
  // mutation wiring and dialog guards must survive the restyle
  expect(page).toContain("toggleManifestItem");
  expect(page).toContain("deleteManifestItem");
  expect(page).toContain("reorderManifestItem");
  expect(page).toContain("updateManifestMetadata");
  expect(page).toContain("disabled={pendingItem === item.audio_id}");
});
