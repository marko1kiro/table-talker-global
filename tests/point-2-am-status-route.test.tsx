// @vitest-environment jsdom
// R4-D (round 4 review): direct-route evidence that a STALE cookie never
// renders the authenticated AM dashboard. The real route component runs in
// jsdom with the loader verdict injected; every authoritative-decline case
// (revoked / password change / deactivate / mismatch / malformed-expired)
// collapses to {authenticated:false} upstream (amStatusCore) and renders the
// logged-out card — never the dashboard shell.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigations: string[] = [];
const holder = globalThis as { __amLoaderData?: unknown };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: Record<string, unknown>): Record<string, unknown> => ({
      ...options,
      useLoaderData: () => (globalThis as { __amLoaderData?: unknown }).__amLoaderData,
    }),
  useNavigate:
    () =>
    async (opts: { to: string }): Promise<void> => {
      navigations.push(opts.to);
    },
  Link: () => null,
}));
vi.mock("@/lib/area-manager.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/area-manager.server")>();
  return {
    ...actual,
    getAmStatus: async () => (globalThis as { __amLoaderData?: unknown }).__amLoaderData,
    amScope: async () => ({ ok: true, restaurants: [] }),
    amManagers: async () => ({ ok: true, managers: [] }),
    amPendingResets: async () => ({ ok: true, requests: [] }),
    amAudit: async () => ({ ok: true, entries: [] }),
    amLogout: async () => ({ ok: true }),
    amSetManagerStatus: async () => ({ ok: true }),
    amRenameManager: async () => ({ ok: true }),
    amDecideManagerReset: async () => ({ ok: true }),
    amCreateManager: async () => ({ ok: true }),
    amChangeOwnPassword: async () => ({ ok: true }),
    updateOwnAmProfile: async () => ({ ok: true }),
  };
});

import * as amRoute from "../src/routes/am/index";
import { amStatusCore } from "../src/lib/area-manager.server";
import type { ComponentType } from "react";

const AreaManagerDashboard = (amRoute.Route as unknown as { component: ComponentType }).component;

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(QueryClientProvider, { client }, createElement(AreaManagerDashboard)),
  );
}

describe("R4-D: amStatusCore declines every stale-cookie case", () => {
  const okAccount = {
    staff_id: "am.satu",
    full_name: "AM Satu",
    password_changed_at: "2026-09-09T00:00:00Z",
  };

  async function status(
    sessionAccount: (kind: "area_manager", token: string) => Promise<string | null>,
  ) {
    return amStatusCore({
      accountId: "am-1",
      sessionToken: "tok",
      sessionAccount,
      fetchAccount: async () => okAccount,
    });
  }

  it("session revoke -> not authenticated", async () => {
    expect(await status(async () => null)).toEqual({ authenticated: false });
  });
  it("password change/reset (all sessions revoked) -> not authenticated", async () => {
    expect(await status(async () => null)).toEqual({ authenticated: false });
  });
  it("account deactivation (sessions revoked) -> not authenticated", async () => {
    expect(await status(async () => null)).toEqual({ authenticated: false });
  });
  it("account/token mismatch -> not authenticated", async () => {
    expect(await status(async () => "someone-else")).toEqual({ authenticated: false });
  });
  it("malformed/expired session (lookup error/null) -> not authenticated", async () => {
    expect(
      await status(async () => {
        throw new Error("malformed");
      }),
    ).toEqual({ authenticated: false });
  });
  it("live matching token + active account -> authenticated", async () => {
    const r = await status(async () => "am-1");
    expect(r).toMatchObject({ authenticated: true, staffId: "am.satu" });
  });
});

describe("R4-D: stale cookie never renders the authenticated AM dashboard", () => {
  beforeEach(() => {
    navigations.length = 0;
  });
  afterEach(() => {
    cleanup();
  });

  it("authenticated:false (revoked/password-change/deactivated/mismatch/expired) shows ONLY the logged-out card", () => {
    holder.__amLoaderData = { authenticated: false };
    renderDashboard();
    expect(screen.getByText("Sesi Berakhir")).toBeTruthy();
    expect(screen.queryByText("Restoran dalam Scope")).toBeNull();
    expect(screen.queryByText("Permintaan Reset Password Manager")).toBeNull();
  });

  it("authenticated:true renders the dashboard for the session's own account", () => {
    holder.__amLoaderData = {
      authenticated: true,
      fullName: "AM Satu",
      staffId: "am.satu",
      mustRemindPassword: false,
    };
    renderDashboard();
    expect(screen.getByText("Restoran dalam Scope")).toBeTruthy();
    expect(screen.queryByText("Sesi Berakhir")).toBeNull();
  });
});
