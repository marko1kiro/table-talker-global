import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Halaman daftar restoran Super Admin direstyle dari kartu grid menjadi
// tabel padat (satu baris per restoran) agar efisien dipindai. Kontrak lain
// (link detail, dialog kredensial, header + tombol tambah) tidak berubah.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("renders the restaurant list as a shadcn table, not cards", () => {
  const list = read("../src/routes/super-admin/restaurants/index.tsx");
  expect(list).toContain('from "@/components/ui/table"');
  expect(list).toContain("<Table>");
  expect(list).toContain("<TableHeader>");
  expect(list).toContain("<TableBody>");
  expect(list).not.toContain("<article");
});

it("table shows every management column per restaurant row", () => {
  const list = read("../src/routes/super-admin/restaurants/index.tsx");
  for (const head of ["Restoran", "Status", "Katalog", "Diputar Hari Ini", "Sinkronisasi"]) {
    expect(list).toContain(`>${head}</TableHead>`);
  }
  expect(list).toContain("row.display_name");
  expect(list).toContain("row.is_active");
  expect(list).toContain("row.catalog_version");
  expect(list).toContain("row.plays_today");
  expect(list).toContain("row.latest_sync_failure");
});

it("keeps the row link to restaurant detail", () => {
  const list = read("../src/routes/super-admin/restaurants/index.tsx");
  expect(list).toContain('to="/super-admin/restaurants/$id"');
  expect(list).toContain("params={{ id: row.id }}");
});
