// @vitest-environment jsdom
// R4-D (round 4 review): runtime route/client evidence for the recovery flow.
// The REAL component runs in jsdom: request/reset stage behaviour, query
// validation variants, one-time consume, failure + re-submit, and proof the
// raw token never lands in web storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const recoveryRequests: Array<{ email: string }> = [];
const recoveryConsumes: Array<{ staffId: string; token: string; password: string }> = [];
let consumeResult: { ok: boolean } = { ok: false };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: () => null,
}));
vi.mock("@/lib/super-admin-auth.server", () => ({
  requestSuperAdminRecovery: async ({ data }: { data: { email: string } }) => {
    recoveryRequests.push({ email: data.email });
    return { ok: true };
  },
  consumeSuperAdminRecovery: async ({ data }: { data: { staffId: string; token: string } }) => {
    recoveryConsumes.push({ staffId: data.staffId, token: data.token, password: "redacted" });
    return consumeResult;
  },
}));

import * as recoveryRoute from "../src/routes/super-admin/recovery";
import { RecoveryPageInner } from "../src/routes/super-admin/recovery";

const validateSearch = (
  recoveryRoute.Route as unknown as {
    validateSearch: (s: Record<string, unknown>) => { staff_id?: string; token?: string };
  }
).validateSearch;

const VALID_TOKEN = "tok-1234567890abcdef";

describe("R4-D: recovery route query handling", () => {
  it("missing, empty, duplicate, array, non-string, and malformed params never open the reset stage", () => {
    for (const bad of [
      {},
      { staff_id: "", token: "" },
      { staff_id: ["sa.utama"], token: [VALID_TOKEN] },
      { staff_id: 42, token: { evil: true } },
      { staff_id: null, token: undefined },
      { staff_id: "sa.utama" }, // token missing
      { token: VALID_TOKEN }, // staff_id missing
      { staff_id: true, token: false },
    ]) {
      const search = validateSearch(bad as Record<string, unknown>);
      const html = renderToString(createElement(RecoveryPageInner, { search }));
      expect(html, JSON.stringify(bad)).not.toContain("Reset Password Super Admin");
    }
    // Valid pair opens the reset stage prefilled.
    const search = validateSearch({ staff_id: "sa.utama", token: VALID_TOKEN });
    expect(search).toEqual({ staff_id: "sa.utama", token: VALID_TOKEN });
  });
});

describe("R4-D: recovery route runtime behaviour", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    recoveryRequests.length = 0;
    recoveryConsumes.length = 0;
    consumeResult = { ok: true };
  });

  afterEach(() => {
    cleanup();
  });

  it("request stage: empty/invalid email never calls the server; valid email reports the generic notice", async () => {
    const user = userEvent.setup();
    render(<RecoveryPageInner search={{}} />);
    const email = screen.getByLabelText("Email");
    await user.type(email, "bukan-email");
    const send = screen.getByRole("button", { name: /kirim token reset/i });
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.clear(email);
    await user.type(email, "sa@lime.test");
    await user.click(send);
    expect(recoveryRequests).toEqual([{ email: "sa@lime.test" }]);
    expect(screen.getByRole("status").textContent).toContain("Jika email terdaftar");
  });

  it("'Sudah punya token?' switches from the request stage to the reset stage (back path)", async () => {
    const user = userEvent.setup();
    render(<RecoveryPageInner search={{}} />);
    await user.click(screen.getByRole("button", { name: /sudah punya token\?/i }));
    expect(screen.getByLabelText("ID Super Admin")).toBeTruthy();
    expect(screen.getByLabelText("Token Reset")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("reset stage: incomplete input never calls the server; valid input consumes the one-time token", async () => {
    const user = userEvent.setup();
    render(<RecoveryPageInner search={{ staff_id: "sa.utama", token: VALID_TOKEN }} />);
    const submit = screen.getByRole("button", { name: /reset password/i });
    // Password too short -> client-side guard, no server call.
    await user.type(screen.getByLabelText("Password Baru"), "short");
    await user.click(submit);
    expect(recoveryConsumes).toEqual([]);
    // Full valid input -> consume called with the exact id + token.
    await user.clear(screen.getByLabelText("Password Baru"));
    await user.type(screen.getByLabelText("Password Baru"), "password-baru-1");
    await user.type(screen.getByLabelText("Ketik Ulang Password"), "password-baru-1");
    await user.click(submit);
    expect(recoveryConsumes).toEqual([
      { staffId: "sa.utama", token: VALID_TOKEN, password: "redacted" },
    ]);
    expect(screen.getByText("Password Direset")).toBeTruthy();
  });

  it("invalid/expired/used token shows the GENERIC failure and allows a corrected re-submit", async () => {
    consumeResult = { ok: false };
    const user = userEvent.setup();
    render(<RecoveryPageInner search={{ staff_id: "sa.utama", token: VALID_TOKEN }} />);
    await user.type(screen.getByLabelText("Password Baru"), "password-baru-1");
    await user.type(screen.getByLabelText("Ketik Ulang Password"), "password-baru-1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Token tidak valid atau sudah digunakan.",
    );
    // Re-submit after correcting the token (fresh link) succeeds.
    consumeResult = { ok: true };
    await user.clear(screen.getByLabelText("Token Reset"));
    await user.type(screen.getByLabelText("Token Reset"), "tok-fresh-link-0123456789");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    expect(screen.getByText("Password Direset")).toBeTruthy();
    expect(recoveryConsumes).toHaveLength(2);
  });

  it("the raw token NEVER lands in localStorage or sessionStorage", async () => {
    const user = userEvent.setup();
    render(<RecoveryPageInner search={{ staff_id: "sa.utama", token: VALID_TOKEN }} />);
    await user.type(screen.getByLabelText("Password Baru"), "password-baru-1");
    await user.type(screen.getByLabelText("Ketik Ulang Password"), "password-baru-1");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    // The login client key may live in localStorage — the TOKEN may not.
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const value = store.getItem(store.key(i) as string) ?? "";
        expect(value, store.key(i) as string).not.toContain(VALID_TOKEN);
        expect(store.key(i) as string).not.toContain(VALID_TOKEN);
      }
    }
  });
});
