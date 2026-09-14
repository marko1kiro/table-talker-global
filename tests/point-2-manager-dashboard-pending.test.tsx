// @vitest-environment jsdom
// P1-4: a lingering recovery record means the last handoff never reached a
// definitive verdict. The live /manager dashboard must therefore refuse to
// trust the co-existing (never-confirmed) identity: it drops the stale
// identity and bounces to /manager/login, while the recovery record REMAINS so
// the next login submit resumes that exact token+reservation pair.
// Poin 3 fix: the bounce is no longer INSTANT for a bearer-matching record,
// because the handoff core navigates before confirm resolves; the dashboard
// grants a bounded grace window for the in-flight handoff to settle first
// (full settle/corpse matrix in tests/point-3-manager-boot-guard.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// useNavigate must return a STABLE reference per session, exactly like the
// real TanStack Router hook; an unstable mock makes the [navigate] effect dep
// restart the boot guard on every re-render (and hydrate-loop the shell).
const { navigations, navigateMock } = vi.hoisted(() => {
  const seen: string[] = [];
  return {
    navigations: seen,
    navigateMock: async (opts: { to: string }): Promise<void> => {
      seen.push(opts.to);
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigateMock,
  Link: () => null,
}));
vi.mock("@/lib/browser-auth", () => ({
  getSupabaseBrowserClient: () => ({}),
  refreshCarrierToken: async () => "carrier-tok",
}));
// Realtime + notification wiring is not the subject of this mount test; stub
// the two hooks so mounting the dashboard exercises only the identity effect.
vi.mock("@/hooks/use-table-occupancy-realtime", () => ({
  useTableOccupancyRealtime: () => "SUBSCRIBED",
}));
vi.mock("@/hooks/use-notification-center", () => ({
  useNotificationCenter: () => ({
    items: [],
    unread: 0,
    push: () => undefined,
    markRead: () => undefined,
  }),
}));
// The dashboard's server functions must never attempt a real round-trip when a
// clean identity hydrates the shell in the no-pending regression case.
vi.mock("@/lib/manager-dashboard.server", () => ({
  getManagerSnapshotCore: async () => ({ ok: false }),
  getManagerCrewHistory: async () => ({ ok: false, crew: [] }),
}));
vi.mock("@/lib/manager-stats.server", () => ({
  getManagerDailyStats: async () => ({ ok: false }),
}));
vi.mock("@/lib/manager-auth.server", () => ({
  changeManagerPassword: async () => ({ ok: false }),
  logoutManagerSession: async () => ({ ok: true }),
}));
vi.mock("@/lib/auth", () => ({ logout: async () => undefined }));

import * as managerRoute from "../src/routes/manager/index";
import type { ComponentType } from "react";
const ManagerDashboard = (managerRoute.Route as unknown as { component: ComponentType }).component;

// jsdom lacks these browser-only APIs used inside the hydrated dashboard
// shell; stub them so the hydrate case mounts for environment reasons only.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = ObserverStub as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList);

const IDENTITY_KEY = "table-talker.manager-identity";
const PENDING_KEY = "table-talker.manager-pending-handoff";

const identity = {
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "minted-tok",
  accessToken: "anon-tok",
};
const pending = { ...identity, rateLimitReservationId: "res-1" };
const foreignPending = {
  ...pending,
  managerToken: "other-bearer-tok",
  rateLimitReservationId: "res-0",
};

function mountDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(ManagerDashboard)));
}

describe("/manager refuses a lingering handoff identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
    navigations.length = 0;
  });
  afterEach(() => cleanup());

  it("identity + matching pending that never settles: bounce after the grace window, drop identity, keep the record", async () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    mountDashboard();
    // Poin 3: the grace window makes the bounce land ~4.8s after mount.
    await waitFor(() => expect(navigations).toEqual(["/manager/login"]), { timeout: 9000 });
    expect(sessionStorage.getItem(IDENTITY_KEY)).toBeNull();
    // Recovery record survives untouched so the next submit resumes this pair.
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY) as string)).toEqual(pending);
  }, 15000);

  it("identity + pending for a DIFFERENT bearer: cannot be this login's handoff -> instant bounce, record kept", async () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(foreignPending));

    mountDashboard();
    await waitFor(() => expect(navigations).toEqual(["/manager/login"]));
    expect(sessionStorage.getItem(IDENTITY_KEY)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY) as string)).toEqual(foreignPending);
  });

  it("pending only (no identity): still bounces to login", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    mountDashboard();
    await waitFor(() => expect(navigations).toEqual(["/manager/login"]));
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("no pending + identity: hydrates the shell exactly once (no boot restart loop)", async () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

    mountDashboard();
    // Two 1s-tick windows: a restart-prone guard would re-run the effect each
    // render; the stable outcome is a single hydrate and zero navigations.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    expect(navigations).toEqual([]);
    expect(screen.getByText("MEJA KOSONG")).toBeTruthy();
  }, 10000);
});
