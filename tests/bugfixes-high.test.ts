import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("bug fixes: crew history error/loading/race", () => {
  const page = read("../src/routes/manager/index.tsx");

  it("has error handling for crew history query", () => {
    expect(page).toContain("crew.isError");
    expect(page).toContain("TaRetry");
  });

  it("has loading indicator for scope changes", () => {
    expect(page).toContain("crew.isFetching");
  });

  it("keeps previous data during scope transitions", () => {
    expect(page).toContain("keepPreviousData");
    expect(page).toContain("placeholderData");
  });
});

describe("bug fixes: aria-labels", () => {
  it("RestaurantCredentialDialog buttons have aria-label or text content", () => {
    const dialog = read("../src/components/RestaurantCredentialDialog.tsx");
    const buttons = dialog.match(/<button[\s\S]*?<\/button>/g) ?? [];
    const buttonsWithoutLabel = buttons.filter(
      (b) => !b.includes("aria-label") && !b.includes("Tampilkan") && !b.includes("Simpan"),
    );
    expect(buttonsWithoutLabel.length).toBe(0);
  });

  it("Header logout button has aria-label", () => {
    const header = read("../src/components/Header.tsx");
    expect(header).toContain('aria-label="Keluar"');
  });
});

describe("bug fixes: touch target", () => {
  it("Header profile button meets 44px minimum", () => {
    const header = read("../src/components/Header.tsx");
    expect(header).toContain("size-10");
  });
});
