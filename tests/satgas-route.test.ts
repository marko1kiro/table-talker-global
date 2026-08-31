import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/satgas/index.tsx", import.meta.url), "utf8");

describe("Satgas route: registration and role guard", () => {
  it("registers the /satgas/ file route", () => {
    expect(source()).toContain('createFileRoute("/satgas/")');
  });

  it("reads the persisted role session identity on mount, never trusting SSR-time storage", () => {
    const text = source();
    expect(text).toContain("readRoleSessionIdentity(browserSessionStorage())");
    expect(text).toContain("useEffect(");
  });

  it("redirects to / when there is no session, or the stored session is for a different role", () => {
    const text = source();
    expect(text).toMatch(/!stored \|\| stored\.role !== "satgas"/);
    expect(text).toMatch(/navigate\(\{\s*to:\s*"\/"\s*\}\)/);
  });

  it("provides a Keluar action that clears the role session before returning to /", () => {
    const text = source();
    expect(text).toContain("removeRoleSessionIdentity(browserSessionStorage())");
  });
});

describe("Satgas route: grid/list layout preference", () => {
  it('wires the layout toggle to useLayoutPreference("satgas")', () => {
    expect(source()).toContain('useLayoutPreference("satgas")');
  });

  it("renders the grid view when the preference is grid and the list view otherwise", () => {
    const text = source();
    expect(text).toMatch(/layoutPreference === "grid"\s*\?\s*\(?\s*<TableGrid/);
    expect(text).toContain("<TableList");
  });
});

describe("Satgas route: live data via snapshot + realtime", () => {
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
    ).toBe(3);
  });

  it("subscribes via useTableOccupancyRealtime and invalidates the snapshot query on invalidate events", () => {
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

describe("Satgas route: the grid itself is read-only -- Satgas never mutates table status directly", () => {
  it("never calls setTableOccupiedKasir or setTableEmptyCleanup", () => {
    const text = source();
    expect(text).not.toContain("setTableOccupiedKasir");
    expect(text).not.toContain("setTableEmptyCleanup");
  });

  it("disables already-occupied (red) tables so tapping them is a no-op", () => {
    const text = source();
    expect(text).toMatch(/disabled=\{occupied\}/);
    expect(text).toMatch(/aria-disabled=\{occupied\}/);
  });
});

describe("Satgas route: Escort action creates an escort intent, it never marks a table occupied", () => {
  it("shows a confirmation dialog before creating the escort intent", () => {
    const text = source();
    expect(text).toContain("<AlertDialog");
    expect(text).toContain("Escort ke Meja {escortTable}?");
  });

  it("confirming the dialog calls createEscortIntent with the tapped table number", () => {
    const text = source();
    expect(text).toContain("createEscortIntent(");
    expect(text).toContain("escortMutation.mutate(escortTable)");
  });

  it("only opens the escort dialog from the empty-table tap handler, not from the occupied cell", () => {
    const text = source();
    expect(text).toContain("onClick={() => onSelectEmptyTable(tableNumber)}");
    expect((text.match(/onSelectEmptyTable\(tableNumber\)/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("persists the new intent to the escort waitlist, scoped to this role session", () => {
    const text = source();
    expect(text).toContain("addEscortWaitEntry(");
    expect(text).toContain("identity!.roleSessionId");
    expect(text).toContain("intentId: result.intentId");
    expect(text).toContain("ESCORT_INTENT_WINDOW_MS");
  });
});

describe("Satgas route: 30-minute confirm prompt, scoped to this session's own intents", () => {
  it("hydrates the waitlist from storage scoped to this session's roleSessionId, not any other session's", () => {
    const text = source();
    expect(text).toContain("readEscortWaitlist(browserSessionStorage(), stored.roleSessionId)");
  });

  it("re-evaluates on a client-side timer, never an extra server poll beyond the existing snapshot", () => {
    const text = source();
    expect(text).toContain("setInterval(");
    expect(text).toContain("Date.now()");
  });

  it("computes which intents are ready to confirm via partitionEscortWaitlist", () => {
    const text = source();
    expect(text).toContain("partitionEscortWaitlist(");
  });

  it("renders a Konfirmasi button for every ready-to-confirm entry, with no cancel button", () => {
    const text = source();
    expect(text).toContain("partition.readyToConfirm.map(");
    expect(text).toContain("Konfirmasi");
  });

  it("confirming calls confirmEscortIntent with that entry's intentId", () => {
    const text = source();
    expect(text).toContain("confirmEscortIntent(");
    expect(text).toContain("confirmMutation.mutate(entry)");
    expect(text).toContain("intentId: entry.intentId");
  });

  it("removes the entry from the waitlist on success or on ALREADY_OCCUPIED (someone else resolved it)", () => {
    const text = source();
    expect(text).toContain("removeEscortWaitEntry(");
    expect(text).toContain('"ALREADY_OCCUPIED"');
  });

  it("silently retries on INTENT_NOT_FOUND instead of surfacing a false error to Satgas", () => {
    const text = source();
    expect(text).toContain('"INTENT_NOT_FOUND"');
  });
});

describe("Satgas route: an intent resolved by an incoming QR scan before 30 minutes disappears without a prompt", () => {
  it("clears waitlist entries whose table already became terisi via the live snapshot, without a dedicated cancel action", () => {
    const text = source();
    expect(text).toContain("snapshot.data");
    expect(text).toContain("removeEscortWaitEntry(");
    expect(text).not.toContain("cancelEscortIntent");
  });
});

describe("Satgas route: theme", () => {
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
