import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const ui = readFileSync(
  new URL("../src/components/RestaurantCredentialDialog.tsx", import.meta.url),
  "utf8",
);

it("uses password controls, explicit reveal, confirmation, and clears credential state on close", () => {
  expect(ui).toContain('type="password"');
  expect(ui).toContain("Tampilkan Kode Resto");
  expect(ui).toContain("showCode");
  expect(ui).toContain("Tampilkan input Kode Resto");
  expect(ui).toContain("displayNameConfirmation");
  expect(ui).toContain("codeConfirmation");
  expect(ui).toContain('setCode("")');
  expect(ui).toContain('setViewedCode("")');
  expect(ui).not.toContain("localStorage");
  expect(ui).not.toContain("sessionStorage");
});

it("keeps restaurant route free of credential values before restaurant phase", () => {
  const page = readFileSync(
    new URL("../src/routes/super-admin/restaurants/index.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("Belum tersedia.");
  expect(page).not.toContain("RestaurantCredentialDialog");
  expect(page).not.toMatch(/toast\.(success|error)\([^)]*code/i);
});
