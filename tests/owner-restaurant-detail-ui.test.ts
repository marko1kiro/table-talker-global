import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Halaman detail restoran Super Admin direstyle dari wireframe mentah
// (Panel brutalism + List string mentah + tombol tanpa gaya) menjadi layout
// konsisten Owner Console: OwnerPage/OwnerPageHeader/OwnerPanel + tabel
// shadcn per section + tombol owner styles + format waktu Indonesia.
// Kontrak logika tidak berubah (deactivateRestaurant,
// displayNameConfirmation guard, dialog kredensial).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("uses TailAdmin layout primitives instead of raw Panels", () => {
  const page = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(page).toContain("TaPage");
  expect(page).toContain("TaPageHeader");
  expect(page).toContain("TaCard");
  expect(page).toContain("TaLoading");
  expect(page).not.toContain('className="brutal-border bg-card p-6"');
  expect(page).not.toContain("font-display text-2xl uppercase");
});

it("renders catalog, sync, playback, and error sections as shadcn tables", () => {
  const page = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(page).toContain('from "@/components/ui/table"');
  const tables = page.match(/<Table>/g) ?? [];
  expect(tables.length).toBeGreaterThanOrEqual(4);
  for (const head of ["Audio ID", "Label", "Kategori", "Status", "Urutan", "Kode", "Waktu"]) {
    expect(page).toContain(head);
  }
  // no more raw concatenated string dumps
  expect(page).not.toContain("` · `");
});

it("action buttons use TailAdmin button styles", () => {
  const page = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(page).toContain("taPrimaryButtonClass");
  expect(page).toContain("taSecondaryButtonClass");
  expect(page).toContain("taDangerButtonClass");
});

it("formats timestamps in Indonesian locale instead of raw ISO", () => {
  const page = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(page).toContain("formatWaktu");
  expect(page).toContain("dateTimeFormat");
});

it("keeps the deactivate logic contract untouched", () => {
  const page = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(page).toContain("deactivateRestaurant");
  expect(page).toContain("displayNameConfirmation");
  expect(page).toContain("disabled={displayNameConfirmation !== restaurant.displayName}");
  expect(page).toContain("sync_history");
  expect(page).toContain("RestaurantCredentialDialog");
  expect(page).toContain('to="/super-admin/restaurants"');
});
