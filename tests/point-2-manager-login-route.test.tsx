// @vitest-environment jsdom
// R4-A route-level runtime evidence: the ACTUAL /manager/login component runs
// in jsdom, submits the real form, and every browser-handoff failure provably
// calls the server compensation (revoking the just-minted session) while no
// navigation and no identity write happens. Success writes exactly one
// usable identity.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigations: string[] = [];
let loginResult: unknown = { ok: false, message: "Login gagal." };
let anonToken: string | null = null;
let anonThrows = false;
const compensations: string[] = [];
let compensationOk = true;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate:
    () =>
    async (opts: { to: string }): Promise<void> => {
      navigations.push(opts.to);
    },
  Link: () => null,
}));
vi.mock("@/lib/staff-login.server", () => ({
  loginStaff: async () => loginResult,
  revokeManagerLoginCompensation: async ({ data }: { data: { managerToken: string } }) => {
    compensations.push(data.managerToken);
    return { ok: compensationOk };
  },
}));
vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({}),
  ensureAnonAccessToken: async () => {
    if (anonThrows) throw new Error("network down");
    return anonToken;
  },
}));

import * as loginRoute from "../src/routes/manager/login";
import type { ComponentType } from "react";
// StaffLoginPage is not a named export — it is wired as Route.component.
const StaffLoginPage = (loginRoute.Route as unknown as { component: ComponentType }).component;

const managerLogin = {
  ok: true,
  role: "manager",
  managerToken: "minted-tok",
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  mustRemindPassword: false,
};

describe("R4-A: /manager/login runtime handoff behaviour", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    navigations.length = 0;
    compensations.length = 0;
    compensationOk = true;
    anonThrows = false;
    loginResult = { ...managerLogin };
    anonToken = "anon-tok";
  });

  afterEach(() => {
    cleanup();
  });

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("ID Staf"), "kasir.satgas01");
    await user.type(screen.getByLabelText("Password"), "pw123456");
    await user.click(screen.getByRole("button", { name: /login/i }));
  }

  it("success: exactly one usable identity, one navigation, zero compensations", async () => {
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/manager"]);
    expect(compensations).toEqual([]);
    const raw = sessionStorage.getItem("table-talker.manager-identity");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.managerToken).toBe("minted-tok");
    expect(parsed.accessToken).toBe("anon-tok");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("anon token failure: server compensation revokes the minted token, no navigation, no identity", async () => {
    anonToken = null;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(compensations).toEqual(["minted-tok"]);
    expect(navigations).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
  });

  it("anon token TRANSPORT failure: same server compensation", async () => {
    anonThrows = true;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(compensations).toEqual(["minted-tok"]);
    expect(navigations).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
  });

  it("storage unavailable: server compensation fires, nothing navigates", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      const user = userEvent.setup();
      render(<StaffLoginPage />);
      await submit(user);
      expect(compensations).toEqual(["minted-tok"]);
      expect(navigations).toEqual([]);
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("FAILED compensation is still fail closed: generic failure, never navigates", async () => {
    anonToken = null;
    compensationOk = false;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(compensations).toEqual(["minted-tok"]);
    expect(navigations).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
    // The raw token never leaks into the visible failure message.
    expect(screen.getByRole("alert").textContent).not.toContain("minted-tok");
  });

  it("AM role: cookie session made server-side; old manager identity cleared; no compensation", async () => {
    sessionStorage.setItem(
      "table-talker.manager-identity",
      JSON.stringify({ managerToken: "old-tok" }),
    );
    loginResult = { ok: true, role: "area_manager", fullName: "AM", staffId: "am.satu" };
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/am"]);
    expect(compensations).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
  });
});
