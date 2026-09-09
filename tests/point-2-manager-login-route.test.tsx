// @vitest-environment jsdom
// R4-A route-level runtime evidence: the ACTUAL /manager/login component runs
// in jsdom, submits the real form, and every browser-handoff failure provably
// calls the server cleanup (deleting the pending session) while no
// navigation and no identity write happens. Success writes exactly one
// usable identity and confirms the pending→active session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigations: string[] = [];
let loginResult: unknown = { ok: false, message: "Login gagal." };
let anonToken: string | null = null;
let anonThrows = false;
const cleanups: string[] = [];
const confirmations: string[] = [];
let confirmOk = true;

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
  confirmManagerHandoff: async ({ data }: { data: { managerToken: string } }) => {
    confirmations.push(data.managerToken);
    return { ok: confirmOk };
  },
  cleanupManagerPendingSession: async ({ data }: { data: { managerToken: string } }) => {
    cleanups.push(data.managerToken);
    return { ok: true };
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
    cleanups.length = 0;
    confirmations.length = 0;
    confirmOk = true;
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

  it("success: exactly one usable identity, one navigation, one confirmation", async () => {
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual(["minted-tok"]);
    expect(cleanups).toEqual([]);
    const raw = sessionStorage.getItem("table-talker.manager-identity");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.managerToken).toBe("minted-tok");
    expect(parsed.accessToken).toBe("anon-tok");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("anon token failure: pending session cleaned up, no navigation, no identity", async () => {
    anonToken = null;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(cleanups).toEqual(["minted-tok"]);
    expect(confirmations).toEqual([]);
    expect(navigations).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
  });

  it("anon token TRANSPORT failure: same pending cleanup", async () => {
    anonThrows = true;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(cleanups).toEqual(["minted-tok"]);
    expect(navigations).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
  });

  it("storage unavailable: pending cleanup fires, nothing navigates", async () => {
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
      expect(cleanups).toEqual(["minted-tok"]);
      expect(navigations).toEqual([]);
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("FAILED confirmation: pending session cleaned up, generic failure, navigates before confirm", async () => {
    confirmOk = false;
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    // Navigate happens before confirm; on confirm failure, pending is cleaned up
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual(["minted-tok"]);
    expect(cleanups).toEqual(["minted-tok"]);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
    expect(screen.getByRole("alert").textContent).not.toContain("minted-tok");
  });

  it("AM role: cookie session made server-side; old manager identity cleared; no confirm/cleanup", async () => {
    sessionStorage.setItem(
      "table-talker.manager-identity",
      JSON.stringify({ managerToken: "old-tok" }),
    );
    loginResult = { ok: true, role: "area_manager", fullName: "AM", staffId: "am.satu" };
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/am"]);
    expect(confirmations).toEqual([]);
    expect(cleanups).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
  });
});
