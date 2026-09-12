// @vitest-environment jsdom
// Dead-dropdown bug: the "+ tugaskan…" <select> sat inside a <form> with no
// submit button and no change handler, so picking a restaurant did nothing.
// Selecting an option must immediately call saAssignAreaManager, and already
// assigned restaurants must stay excluded.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const holder = globalThis as {
  __assignCalls: Array<{ areaManagerId: string; restaurantId: string }>;
};
holder.__assignCalls = [];

const AM_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  staff_id: "am-restiana",
  full_name: "Restiana",
  status: "aktif",
  created_at: "2026-09-12T00:00:00Z",
  area_manager_assignments: [],
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: Record<string, unknown>): Record<string, unknown> => ({
      ...options,
      useLoaderData: () => undefined,
    }),
}));

vi.mock("@/lib/owner-restaurants.server", () => ({
  listOwnerRestaurants: async () => ({
    ok: true,
    restaurants: [
      { id: "aaaaaaa1-0000-4000-8000-000000000000", display_name: "Resto Satu" },
      { id: "aaaaaaa2-0000-4000-8000-000000000000", display_name: "Resto Dua" },
    ],
  }),
}));

vi.mock("@/lib/area-manager.server", () => ({
  saAreaManagers: async () => ({
    ok: true,
    managers: [(globalThis as { __amRow?: unknown }).__amRow ?? AM_ROW],
  }),
  saAmRolloutReadiness: async () => ({ ok: true, readiness: null }),
  saPendingAmResets: async () => ({ ok: true, requests: [] }),
  saCreateAreaManager: async () => ({ ok: true }),
  saSetAreaManagerStatus: async () => ({ ok: true }),
  saDecideAmReset: async () => ({ ok: true }),
  saAssignAreaManager: async ({
    data,
  }: {
    data: { areaManagerId: string; restaurantId: string };
  }) => {
    (globalThis as { __assignCalls: Array<unknown> }).__assignCalls.push(data);
    return { ok: true };
  },
  saRevokeAreaManagerAssignment: async () => ({ ok: true }),
}));

vi.mock("@/lib/super-admin-auth.server", () => ({
  saRenameStaff: async () => ({ ok: true }),
}));

vi.mock("@/components/dashboard/EditProfileDialog", () => ({
  EditProfileDialog: () => null,
}));

import * as areaManagersRoute from "../src/routes/super-admin/area-managers";
import type { ComponentType } from "react";

const Page = (areaManagersRoute.Route as unknown as { component: ComponentType }).component;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(Page)));
}

describe("AM assignment dropdown", () => {
  beforeEach(() => {
    holder.__assignCalls = [];
  });
  afterEach(cleanup);

  it("selecting a restaurant fires the assign server function immediately", async () => {
    renderPage();
    const select = await screen.findByLabelText("Restoran");
    expect(screen.getByText("Resto Dua", { selector: "option" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "aaaaaaa2-0000-4000-8000-000000000000" } });
    await waitFor(() =>
      expect(holder.__assignCalls).toEqual([
        {
          areaManagerId: AM_ROW.id,
          restaurantId: "aaaaaaa2-0000-4000-8000-000000000000",
        },
      ]),
    );
  });

  it("already-assigned restaurants are excluded from the dropdown", async () => {
    (globalThis as { __amRow?: unknown }).__amRow = {
      ...AM_ROW,
      area_manager_assignments: [
        { restaurant_id: "aaaaaaa1-0000-4000-8000-000000000000", removed_at: null },
      ],
    };
    renderPage();
    const select = await screen.findByLabelText("Restoran");
    expect(screen.queryByText("Resto Satu", { selector: "option" })).toBeNull();
    expect(screen.getByText("Resto Dua", { selector: "option" })).toBeTruthy();
    delete (globalThis as { __amRow?: unknown }).__amRow;
  });
});
