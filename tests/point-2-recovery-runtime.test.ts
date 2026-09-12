// R3-D (round 3 review): runtime evidence for the recovery route. The inner
// component receives the validated search as a prop, so stage selection and
// prefill run for real under react-dom/server — no DOM, no router. The
// validateSearch contract is executed directly.
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: () => null,
}));

import { RecoveryPageInner } from "../src/routes/super-admin/recovery";
import * as recoveryRoute from "../src/routes/super-admin/recovery";

type Search = { staff_id?: string; token?: string };

// The mocked createFileRoute returns the options object verbatim, so the
// exported Route carries the real validateSearch implementation.
const validateSearch = (
  recoveryRoute.Route as unknown as {
    validateSearch: (s: Record<string, unknown>) => Search;
  }
).validateSearch;

function render(search: Search): string {
  return renderToString(createElement(RecoveryPageInner, { search }) as ReactElement);
}

describe("R3-D: recovery route runtime behaviour", () => {
  it("validateSearch keeps strings and drops every other type", () => {
    expect(validateSearch({ staff_id: "sa.utama", token: "tok-123" })).toEqual({
      staff_id: "sa.utama",
      token: "tok-123",
    });
    expect(validateSearch({})).toEqual({});
    expect(validateSearch({ staff_id: 42, token: { evil: true }, extra: "x" })).toEqual({});
    expect(validateSearch({ staff_id: ["a"], token: null })).toEqual({});
  });

  it("staff_id + token in the search opens the RESET stage prefilled", () => {
    const html = render({ staff_id: "sa.utama", token: "tok-1234567890abcdef" });
    expect(html).toContain("Reset Password Super Admin");
    expect(html).toContain('value="sa.utama"');
    expect(html).toContain('value="tok-1234567890abcdef"');
    // The request stage is NOT shown when the link carries both params.
    expect(html).not.toContain("Recovery Super Admin");
  });

  it("without params the REQUEST stage opens (email form, no token fields)", () => {
    const html = render({});
    expect(html).toContain("Recovery Super Admin");
    expect(html).toContain('aria-label="Email"');
    expect(html).not.toContain('aria-label="Token Reset"');
    expect(html).not.toContain("Ketik Ulang Password");
  });
});
