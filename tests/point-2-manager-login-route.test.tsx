// @vitest-environment jsdom
// R4-A/R8 route-level runtime evidence: the ACTUAL /manager/login component
// runs in jsdom and submits the real form. The browser writes the exact
// token+reservation pair, navigates before confirmation, and retries a
// non-true confirmation before reconciling authoritative state. Only a
// definitively pending handoff is cleaned up; uncertain/terminal outcomes are
// not destructively compensated. Success writes one usable identity.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigations: string[] = [];
let loginResult: unknown = { ok: false, message: "Login gagal." };
let anonToken: string | null = null;
let anonThrows = false;
type HandoffPair = { managerToken: string; rateLimitReservationId: string };
const cleanups: HandoffPair[] = [];
const confirmations: HandoffPair[] = [];
const reconciliations: HandoffPair[] = [];
const loginAttempts: Array<{ attemptKey: string; clientKey: string; managerToken?: string }> = [];
// P1-3: backing store used when Storage is stubbed to reject one key.
const mockedStore = new Map<string, string>();
let confirmOk = true;
// R8 contract: after a non-true confirm the browser reads authoritative DB
// state instead of compensating blindly (src/lib/manager-login-handoff.ts).
let reconcileVerdict: "succeeded" | "pending" | "failed" | "unknown" = "pending";

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
  loginStaff: async ({
    data,
  }: {
    data: { attemptKey: string; clientKey: string; managerToken?: string };
  }) => {
    loginAttempts.push({
      attemptKey: data.attemptKey,
      clientKey: data.clientKey,
      managerToken: data.managerToken,
    });
    return loginResult;
  },
  confirmManagerHandoff: async ({ data }: { data: HandoffPair }) => {
    confirmations.push({ ...data });
    return { ok: confirmOk };
  },
  reconcileManagerHandoff: async ({ data }: { data: HandoffPair }) => {
    reconciliations.push({ ...data });
    return { verdict: reconcileVerdict };
  },
  cleanupManagerPendingSession: async ({ data }: { data: HandoffPair }) => {
    cleanups.push({ ...data });
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
  rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  mustRemindPassword: false,
};
const handoffPair: HandoffPair = {
  managerToken: managerLogin.managerToken,
  rateLimitReservationId: managerLogin.rateLimitReservationId,
};

describe("R4-A: /manager/login runtime handoff behaviour", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    navigations.length = 0;
    cleanups.length = 0;
    confirmations.length = 0;
    reconciliations.length = 0;
    loginAttempts.length = 0;
    confirmOk = true;
    reconcileVerdict = "pending";
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
    expect(confirmations).toEqual([handoffPair]);
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
    expect(cleanups).toEqual([handoffPair]);
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
    expect(cleanups).toEqual([handoffPair]);
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
      expect(cleanups).toEqual([handoffPair]);
      expect(navigations).toEqual([]);
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  // R8 contract (src/lib/manager-login-handoff.ts:83-113): navigation occurs
  // before confirmation. A non-true confirm may be a lost response over an
  // already committed activation, so the browser retries the SAME
  // token+reservation twice and then reads authoritative state. Compensation
  // runs only when that state proves the session is still pending — never while
  // activation is uncertain.
  it("FAILED confirmation, still pending: confirm retried twice, then pending session cleaned up", async () => {
    confirmOk = false;
    reconcileVerdict = "pending";
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    // Navigate happens before confirm; the pending session is cleaned up only
    // after reconciliation proves activation never happened.
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual([handoffPair, handoffPair]);
    expect(reconciliations).toEqual([handoffPair]);
    expect(cleanups).toEqual([handoffPair]);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
    expect(screen.getByRole("alert").textContent).not.toContain("minted-tok");
  });

  it("FAILED confirmation, authoritative failed: no compensation, generic failure", async () => {
    confirmOk = false;
    reconcileVerdict = "failed";
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual([handoffPair, handoffPair]);
    expect(reconciliations).toEqual([handoffPair]);
    // The DB already banked the terminal failure; cleanup would be redundant.
    expect(cleanups).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
    expect(screen.getByRole("alert").textContent).not.toContain("minted-tok");
  });

  it("LOST confirmation, authoritative succeeded: session usable, no compensation, no error", async () => {
    confirmOk = false;
    reconcileVerdict = "succeeded";
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual([handoffPair, handoffPair]);
    expect(reconciliations).toEqual([handoffPair]);
    expect(cleanups).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    const raw = sessionStorage.getItem("table-talker.manager-identity");
    expect(JSON.parse(raw as string).managerToken).toBe("minted-tok");
  });

  it("UNKNOWN reconciliation: no cleanup and a generic token-free failure", async () => {
    confirmOk = false;
    reconcileVerdict = "unknown";
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);

    expect(loginAttempts).toHaveLength(1);
    expect(navigations).toEqual(["/manager"]);
    expect(confirmations).toEqual([handoffPair, handoffPair]);
    expect(reconciliations).toEqual([handoffPair]);
    expect(cleanups).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
    expect(screen.getByRole("alert").textContent).not.toContain(managerLogin.managerToken);
    expect(document.body.textContent).not.toContain(managerLogin.managerToken);
  });

  // P1-3: the recoverable pending pair must exist before any other
  // browser-side work. If it cannot be stored, the handoff is a hard
  // pre-confirm failure with the exact cleanup — otherwise a later submit
  // would perform a fresh login and surrender this newly minted pending bearer
  // as its "old" credential to the mandatory revoker.
  it("pending record cannot be persisted: exact cleanup, no identity, no navigation", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (key === "table-talker.manager-pending-handoff") throw new Error("QuotaExceededError");
        mockedStore.set(key, value);
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((key: string) => mockedStore.get(key) ?? null);
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation((key: string) => void mockedStore.delete(key));
    try {
      const user = userEvent.setup();
      render(<StaffLoginPage />);
      await submit(user);
      expect(cleanups).toEqual([handoffPair]);
      expect(confirmations).toEqual([]);
      expect(reconciliations).toEqual([]);
      expect(navigations).toEqual([]);
      expect(mockedStore.get("table-talker.manager-identity")).toBeUndefined();
      expect(mockedStore.get("table-talker.manager-pending-handoff")).toBeUndefined();
      expect(screen.getByRole("alert").textContent).toContain("Gagal memulai sesi. Coba lagi.");
      expect(document.body.textContent).not.toContain(managerLogin.managerToken);
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
      removeItem.mockRestore();
      mockedStore.clear();
    }
  });

  // P1-3: an UNKNOWN reconciliation keeps the recovery record, so the next
  // submit RESUMES that exact pair. It must never re-enter loginStaff, which
  // would hand the pending bearer to the mandatory old-credential revoker.
  it("uncertain handoff: the next submit resumes the stored pair, no fresh login", async () => {
    confirmOk = false;
    reconcileVerdict = "unknown";
    const user = userEvent.setup();
    render(<StaffLoginPage />);
    await submit(user);
    expect(loginAttempts).toHaveLength(1);
    expect(loginAttempts[0]?.managerToken).toBeUndefined();
    const stored = sessionStorage.getItem("table-talker.manager-pending-handoff");
    expect(JSON.parse(stored as string)).toEqual({
      idManager: managerLogin.idManager,
      fullName: managerLogin.fullName,
      restaurantId: managerLogin.restaurantId,
      restaurantDisplayName: managerLogin.restaurantDisplayName,
      restaurantCode: managerLogin.restaurantCode,
      managerToken: managerLogin.managerToken,
      rateLimitReservationId: managerLogin.rateLimitReservationId,
    });

    confirmOk = true;
    await user.click(screen.getByRole("button", { name: /login/i }));
    // Resumed: no second loginStaff call, the SAME pair confirmed, and the
    // recovery record retired only after the confirmation succeeded.
    expect(loginAttempts).toHaveLength(1);
    expect(confirmations).toEqual([handoffPair, handoffPair, handoffPair]);
    expect(cleanups).toEqual([]);
    expect(sessionStorage.getItem("table-talker.manager-pending-handoff")).toBeNull();
    expect(
      JSON.parse(sessionStorage.getItem("table-talker.manager-identity") as string).managerToken,
    ).toBe(managerLogin.managerToken);
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
