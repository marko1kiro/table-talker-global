// @vitest-environment jsdom
// Bootstrap dead-end fix: a legacy (bootstrap) Super Admin session has no
// individual account, so the invite form can only ever answer
// INDIVIDUAL_REQUIRED. The page must instead offer the
// `bootstrapCreateSuperAdmin` form to mint the FIRST individual account, and
// only expose the invite form once the session is individual.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const holder = globalThis as {
  __saProfile?: unknown;
  __bootstrapCalls: Array<unknown>;
  __bootstrapResult?: unknown;
};
holder.__bootstrapCalls = [];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: Record<string, unknown>): Record<string, unknown> => ({
      ...options,
      useLoaderData: () => undefined,
    }),
}));

vi.mock("@/lib/super-admin-auth.server", () => ({
  getSuperAdmins: async () => ({ ok: true, accounts: [] }),
  getSuperAdminProfile: async () => (globalThis as { __saProfile?: unknown }).__saProfile,
  inviteSuperAdmin: async () => ({ ok: true }),
  resendSuperAdminInvite: async () => ({ ok: true }),
  cancelSuperAdminInvite: async () => ({ ok: true }),
  setSuperAdminStatus: async () => ({ ok: true }),
  saRenameStaff: async () => ({ ok: true }),
  bootstrapCreateSuperAdmin: async (args: { data: unknown }) => {
    (globalThis as { __bootstrapCalls: Array<unknown> }).__bootstrapCalls.push(args.data);
    return (globalThis as { __bootstrapResult?: unknown }).__bootstrapResult ?? { ok: true };
  },
}));

import * as staffAccountsRoute from "../src/routes/super-admin/staff-accounts";
import type { ComponentType } from "react";

const StaffAccountsPage = (staffAccountsRoute.Route as unknown as { component: ComponentType })
  .component;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(StaffAccountsPage)));
}

describe("bootstrap first-account form", () => {
  beforeEach(() => {
    holder.__bootstrapCalls = [];
    holder.__bootstrapResult = { ok: true };
  });
  afterEach(cleanup);

  it("legacy session sees the bootstrap form, NOT the invite form", async () => {
    holder.__saProfile = { individual: false };
    renderPage();
    await waitFor(() => screen.getByText("Buat Akun Super Admin Pertama"));
    expect(screen.queryByText("Undang Super Admin Baru")).toBeNull();
  });

  it("individual session sees the invite form, NOT the bootstrap form", async () => {
    holder.__saProfile = { individual: true, staffId: "ada.satu", fullName: "Ada Satu" };
    renderPage();
    await waitFor(() => screen.getByText("Undang Super Admin Baru"));
    expect(screen.queryByText("Buat Akun Super Admin Pertama")).toBeNull();
  });

  it("submitting the bootstrap form calls bootstrapCreateSuperAdmin with trimmed fields", async () => {
    holder.__saProfile = { individual: false };
    renderPage();
    await waitFor(() => screen.getByText("Buat Akun Super Admin Pertama"));
    fireEvent.change(screen.getByLabelText("ID Super Admin Pertama"), {
      target: { value: " ada.satu " },
    });
    fireEvent.change(screen.getByLabelText("Nama Super Admin"), {
      target: { value: " Ada Satu " },
    });
    fireEvent.change(screen.getByLabelText("Email Aktivasi"), {
      target: { value: " ada@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat & Kirim Aktivasi" }));
    await waitFor(() => expect(holder.__bootstrapCalls.length).toBe(1));
    expect(holder.__bootstrapCalls[0]).toEqual({
      staffId: "ada.satu",
      fullName: "Ada Satu",
      email: "ada@example.com",
    });
  });

  it("email failure surfaces the code instead of a silent no-op", async () => {
    holder.__saProfile = { individual: false };
    holder.__bootstrapResult = { ok: false, code: "EMAIL_UNAVAILABLE" };
    renderPage();
    await waitFor(() => screen.getByText("Buat Akun Super Admin Pertama"));
    fireEvent.change(screen.getByLabelText("ID Super Admin Pertama"), {
      target: { value: "ada.satu" },
    });
    fireEvent.change(screen.getByLabelText("Nama Super Admin"), {
      target: { value: "Ada Satu" },
    });
    fireEvent.change(screen.getByLabelText("Email Aktivasi"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat & Kirim Aktivasi" }));
    await waitFor(() => expect(screen.getByText(/EMAIL_UNAVAILABLE/)).toBeTruthy());
  });
});
