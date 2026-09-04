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
    expect(text).toMatch(
      /import \{\s*getLiveAccessToken,\s*getSupabaseBrowserClient,?\s*\} from "@\/lib\/supabase-browser";/,
    );
    expect(text).not.toContain("accessToken: identity!.accessToken");
    expect(
      (
        text.match(
          /accessToken: await getLiveAccessToken\(\s*getSupabaseBrowserClient\(\),\s*identity!\.accessToken,?\s*\)/g,
        ) ?? []
      ).length,
      ).toBe(4);
  });

  it("captures the realtime status used by the connection notice and invalidates the snapshot on events", () => {
    const text = source();
    expect(text).toMatch(
      /const realtimeStatus = useTableOccupancyRealtime\(\s*restaurantId,\s*identity\?\.roleSessionToken \?\? "",\s*snapshot\.data\?\.ok \? snapshot\.data\.revision : null,/,
    );
    expect(text).toContain('realtimeStatus !== "SUBSCRIBED"');
    expect(text).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*snapshotQueryKey\(restaurantId\),?\s*\}\)/,
    );
  });

  it("uses realtime-first refresh with no route-level polling interval", () => {
    const text = source();
    expect(text).not.toContain("refetchInterval");
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
    // `occupied` is the leading condition; pending-mutation and escorted
    // guards were added alongside it so a tap can't double-fire mid-request
    // and an already-escorted table can't be escorted twice -- but occupied
    // tables must stay disabled regardless.
    expect(text).toMatch(/disabled=\{occupied(\s*\|\|[^}]+)?\}/);
    expect(text).toMatch(/aria-disabled=\{occupied(\s*\|\|[^}]+)?\}/);
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

  it("routes an empty-table tap to escort and an escorted-table tap to cancel", () => {
    const text = source();
    expect(text).toContain("onSelectEmptyTable(tableNumber)");
    expect(text).toContain("onSelectEscortedTable(");
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

describe("Satgas route: 10-minute confirm prompt, scoped to this session's own intents", () => {
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

describe("Satgas route: an intent resolved by an incoming QR scan before 10 minutes disappears without a prompt", () => {
  it("adds a cancel-escort action while keeping QR-scan auto-clear of the waitlist", () => {
    const text = source();
    expect(text).toContain("cancelEscortIntent(");
    expect(text).toContain("removeEscortWaitEntry(");
    expect(text).toContain("snapshot.data");
  });
});

describe("Satgas route: theme", () => {
  it("uses the OwnerUi.tsx component set (via the shared CrewHeader), not the SS neo-brutalist theme", () => {
    const text = source();
    // Task 11: OwnerPageHeader was superseded by the shared CrewHeader
    // component (also used by Kasir/Clear Up) once all three role routes
    // converged on the same header/table-section shell; OwnerPage (page
    // shell) and OwnerPanel (admin-note banner) are both still used here.
    expect(text).toContain('from "@/components/OwnerUi"');
    expect(text).toContain("OwnerPage");
    expect(text).toContain("OwnerPanel");
    expect(text).toContain('from "@/components/CrewHeader"');
    expect(text).toContain("<CrewHeader");
  });

  it("colors KOSONG green (emerald) and TERISI red, per spec", () => {
    const text = source();
    expect(text).toContain("emerald");
    expect(text).toMatch(/red-(50|300|700)/);
  });

  it("colors a KOSONG table that has been escorted (pending confirm) amber/kuning instead of green", () => {
    const text = source();
    expect(text).toMatch(/amber-(50|100|300|700|800)/);
    expect(text).toContain("escortedTableNumbers");
  });
});

describe("Satgas route: escorted-table highlight", () => {
  it("derives escortedTableNumbers from the waitlist partition's stillWaiting and readyToConfirm buckets", () => {
    const text = source();
    expect(text).toContain("partition.stillWaiting");
    expect(text).toContain("partition.readyToConfirm");
    expect(text).toMatch(/escortedTableNumbers\s*=\s*useMemo/);
  });

  it("only treats a table as escorted while it is not already occupied", () => {
    const text = source();
    expect(text).toContain("!occupied && escortedTableNumbers.has(tableNumber)");
  });

  it("passes escortedTableNumbers to both TableGrid and TableList", () => {
    const text = source();
    expect(text).toMatch(
      /<TableGrid\s+tables={tables}\s+escortedTableNumbers={escortedTableNumbers}/,
    );
    expect(text).toMatch(
      /<TableList\s+tables={tables}\s+escortedTableNumbers={escortedTableNumbers}/,
    );
  });
});
