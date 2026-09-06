import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager table grid matches kasir grid", () => {
  const manager = read("../src/routes/manager/index.tsx");
  const kasir = read("../src/routes/kasir/index.tsx");

  it("manager dan kasir memiliki breakpoint grid-cols yang sama di desktop", () => {
    const expectedGridClass =
      "grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-2.5 md:grid-cols-10 lg:grid-cols-12 lg:gap-3 xl:grid-cols-[repeat(15,minmax(0,1fr))] 2xl:grid-cols-[repeat(18,minmax(0,1fr))]";
    expect(kasir).toContain(expectedGridClass);
    expect(manager).toContain(expectedGridClass);
  });
});
