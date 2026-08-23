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

it("shows restaurant controls only in owner page and never lists credential values", () => {
  const page = readFileSync(new URL("../src/routes/super-admin.tsx", import.meta.url), "utf8");
  expect(page).toContain("RestaurantCredentialDialog");
  expect(page).toContain("display_name");
  expect(page).not.toMatch(/toast\.(success|error)\([^)]*code/i);
});
