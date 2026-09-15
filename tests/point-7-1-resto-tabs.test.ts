// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { resolveRestoPick, restoPickKey } from "../src/lib/am-resto-pick";
import { AmRestoTabs } from "../src/components/am/AmRestoTabs";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("resolveRestoPick", () => {
  it("returns stored id when still in scope", () => {
    expect(resolveRestoPick("r2", [{ id: "r1" }, { id: "r2" }])).toBe("r2");
  });
  it("falls back to first scope resto when stored id left scope", () => {
    expect(resolveRestoPick("rx", [{ id: "r1" }])).toBe("r1");
  });
  it("returns null for empty scope", () => {
    expect(resolveRestoPick("r1", [])).toBeNull();
    expect(resolveRestoPick(null, [])).toBeNull();
  });
});

describe("AmRestoTabs value wins", () => {
  it("value menang atas storage basi", () => {
    localStorage.setItem(restoPickKey("meja"), "r2");
    render(
      createElement(AmRestoTabs, {
        menu: "meja",
        restos: [
          { id: "r1", name: "R1" },
          { id: "r2", name: "R2" },
        ],
        value: "r1",
        onChange: () => {},
      }),
    );
    expect(screen.getByRole("button", { name: "R1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "R2" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("render group role tanpa tablist palsu", () => {
    render(
      createElement(AmRestoTabs, {
        menu: "meja",
        restos: [
          { id: "r1", name: "R1" },
          { id: "r2", name: "R2" },
        ],
        value: null,
        onChange: () => {},
      }),
    );
    expect(screen.getByRole("group", { name: "Pilih resto" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
