import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/kasir/index.tsx", import.meta.url), "utf8");

describe("Kasir route: registration and role guard", () => {
  it("registers the /kasir/ file route", () => {
    expect(source()).toContain('createFileRoute("/kasir/")');
  });

  it("reads the persisted role session identity on mount, never trusting SSR-time storage", () => {
    const text = source();
    expect(text).toContain("readRoleSessionIdentity(browserSessionStorage())");
    expect(text).toContain("useEffect(");
  });

  it("redirects to / when there is no session, or the stored session is for a different role", () => {
    const text = source();
    expect(text).toMatch(/!stored \|\| stored\.role !== "kasir"/);
    expect(text).toMatch(/navigate\(\{\s*to:\s*"\/"\s*\}\)/);
  });

  it("provides a Keluar action that clears the role session before returning to /", () => {
    const text = source();
    expect(text).toContain("removeRoleSessionIdentity(browserSessionStorage())");
  });
});

describe("Kasir route: grid/list layout preference", () => {
  it('wires the layout toggle to useLayoutPreference("kasir")', () => {
    expect(source()).toContain('useLayoutPreference("kasir")');
  });

  it("renders the grid view when the preference is grid and the list view otherwise", () => {
    const text = source();
    expect(text).toMatch(/layoutPreference === "grid"\s*\?\s*\(?\s*<TableGrid/);
    expect(text).toContain("<TableList");
  });
});

describe("Kasir route: live data via snapshot + realtime", () => {
  it("fetches the occupancy snapshot with the role session's tokens", () => {
    const text = source();
    expect(text).toContain("getTableOccupancySnapshot(");
    expect(text).toContain("sessionToken: identity!.roleSessionToken");
  });

  // Task 14 bugfix: a stale accessToken captured once at login and reused
  // for the rest of the shift starts failing every RPC call with a 401
  // ("JWT expired") after the Supabase Auth access token's 1-hour TTL
  // elapses -- confirmed via a real pilot test. Every authenticated call
  // site must re-derive a live token via getLiveAccessToken immediately
  // before the request instead of reading identity.accessToken directly.
  it("re-derives a live access token via getLiveAccessToken instead of reusing the stale login-time snapshot", () => {
    const text = source();
    expect(text).toContain(
      'import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser"',
    );
    expect(text).not.toContain("accessToken: identity!.accessToken");
    expect(
      (
        text.match(
          /accessToken: await getLiveAccessToken\(getSupabaseBrowserClient\(\), identity!\.accessToken\)/g,
        ) ?? []
      ).length,
    ).toBe(2);
  });

  it("subscribes via useTableOccupancyRealtime and invalidates the snapshot query on invalidate events, without a manual refresh", () => {
    const text = source();
    expect(text).toContain("useTableOccupancyRealtime(restaurantId,");
    expect(text).toContain(
      "queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) })",
    );
  });

  it("defaults any table missing from the snapshot to kosong rather than looking broken", () => {
    const text = source();
    expect(text).toMatch(/\?\?\s*"kosong"/);
  });
});

describe("Kasir route: KOSONG -> TERISI is the only transition Kasir may perform", () => {
  it("shows a confirmation dialog before marking a table occupied", () => {
    const text = source();
    expect(text).toContain("<AlertDialog");
    expect(text).toContain("Tandai Meja {confirmTable} Terisi?");
  });

  it("confirming the dialog calls setTableOccupiedKasir with the tapped table number", () => {
    const text = source();
    expect(text).toContain("setTableOccupiedKasir(");
    expect(text).toContain("markOccupied.mutate(confirmTable)");
  });

  it("never calls setTableEmptyCleanup -- Kasir can only fill a table, never empty it", () => {
    const text = source();
    expect(text).not.toContain("setTableEmptyCleanup");
  });

  it("disables already-occupied (red) tables so tapping them is a no-op", () => {
    const text = source();
    expect(text).toMatch(/disabled=\{occupied\}/);
    expect(text).toMatch(/aria-disabled=\{occupied\}/);
  });

  it("only opens the confirmation dialog from the empty-table tap handler, not from the occupied cell", () => {
    const text = source();
    // Both TableGrid and TableList wire their button onClick to
    // onSelectEmptyTable, but the button itself is disabled when occupied,
    // so a tap on a red table can never reach setConfirmTable.
    expect(text).toContain("onClick={() => onSelectEmptyTable(tableNumber)}");
    expect((text.match(/onSelectEmptyTable\(tableNumber\)/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("Kasir route: theme", () => {
  it("uses the OwnerUi.tsx component set, not the SS neo-brutalist theme", () => {
    const text = source();
    expect(text).toContain('from "@/components/OwnerUi"');
    expect(text).toContain("OwnerPage");
    expect(text).toContain("OwnerPageHeader");
    expect(text).toContain("OwnerPanel");
  });

  it("colors KOSONG green (emerald) and TERISI red, per spec", () => {
    const text = source();
    expect(text).toContain("emerald");
    expect(text).toMatch(/red-(50|300|700)/);
  });
});
