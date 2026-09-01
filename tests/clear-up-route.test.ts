// Task 12: Clear Up route. Source-contract checks mirroring the
// established convention for these role routes (tests/kasir-route.test.ts,
// tests/satgas-route.test.ts) -- scanning the compiled TSX source rather
// than mounting a full React tree, consistent with this codebase's
// existing tests for /kasir and /satgas.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/clear-up/index.tsx", import.meta.url), "utf8");

describe("Clear Up route: registration and role guard", () => {
  it("registers the /clear-up/ file route", () => {
    expect(source()).toContain('createFileRoute("/clear-up/")');
  });

  it("reads the persisted role session identity on mount, never trusting SSR-time storage", () => {
    const text = source();
    expect(text).toContain("readRoleSessionIdentity(browserSessionStorage())");
    expect(text).toContain("useEffect(");
  });

  it("redirects to / when there is no session, or the stored session is for a different role", () => {
    const text = source();
    expect(text).toMatch(/!stored \|\| stored\.role !== "clear_up"/);
    expect(text).toMatch(/navigate\(\{\s*to:\s*"\/"\s*\}\)/);
  });

  it("provides a Keluar action that clears the role session before returning to /", () => {
    const text = source();
    expect(text).toContain("removeRoleSessionIdentity(browserSessionStorage())");
  });
});

describe("Clear Up route: grid/list layout preference", () => {
  it('wires the layout toggle to useLayoutPreference("clear_up")', () => {
    expect(source()).toContain('useLayoutPreference("clear_up")');
  });

  it("renders the grid view when the preference is grid and the list view otherwise", () => {
    const text = source();
    expect(text).toMatch(/layoutPreference === "grid"\s*\?\s*\(?\s*<TableGrid/);
    expect(text).toContain("<TableList");
  });
});

describe("Clear Up route: live data via snapshot + realtime, filtered to the occupied queue", () => {
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
    ).toBe(2);
  });

  it("captures the realtime status used by the connection notice and invalidates the snapshot on events", () => {
    const text = source();
    expect(text).toMatch(
      /const realtimeStatus = useTableOccupancyRealtime\(\s*restaurantId,\s*snapshot\.data\?\.ok \? snapshot\.data\.revision : null,/,
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

  it("builds the queue via the pure sortedOccupiedTables helper rather than duplicating the filter/sort logic inline", () => {
    const text = source();
    expect(text).toContain('from "@/lib/clear-up-queue"');
    expect(text).toContain("sortedOccupiedTables(");
  });

  it("shows an empty state when no tables are currently occupied", () => {
    const text = source();
    expect(text).toContain("OwnerEmpty");
  });
});

describe("Clear Up route: duration is computed client-side only, no extra server call to keep it live", () => {
  it("ticks a client-side clock via setInterval, independent from the snapshot refetch", () => {
    const text = source();
    expect(text).toMatch(/setInterval\(\(\)\s*=>\s*setNow\(Date\.now\(\)\)/);
  });

  it("renders the duration label via formatOccupiedDuration", () => {
    const text = source();
    expect(text).toContain("formatOccupiedDuration(");
  });

  it("the setInterval tick callback never calls the snapshot query functions or invalidateQueries", () => {
    const text = source();
    const tickMatch = text.match(/setInterval\(\(\)\s*=>\s*setNow\(Date\.now\(\)\)[^;]*\)/);
    expect(tickMatch).not.toBeNull();
    const tickBody = tickMatch![0];
    expect(tickBody).not.toContain("getTableOccupancySnapshot");
    expect(tickBody).not.toContain("invalidateQueries");
  });
});

describe("Clear Up route: TERISI -> KOSONG is the only transition Clear Up may perform", () => {
  it("shows a confirmation dialog before marking a table empty", () => {
    const text = source();
    expect(text).toContain("<AlertDialog");
    expect(text).toContain("Tandai Meja {confirmTable} Sudah Dibersihkan?");
  });

  it("confirming the dialog calls setTableEmptyCleanup with the tapped table number", () => {
    const text = source();
    expect(text).toContain("setTableEmptyCleanup(");
    expect(text).toContain("markEmpty.mutate(confirmTable)");
  });

  it("never calls setTableOccupiedKasir -- Clear Up can only empty a table, never fill it", () => {
    const text = source();
    expect(text).not.toContain("setTableOccupiedKasir");
  });
});

describe("Clear Up route: theme", () => {
  it("uses the OwnerUi.tsx component set (via the shared CrewHeader), not the SS neo-brutalist theme", () => {
    const text = source();
    // Task 12: OwnerPageHeader was superseded by the shared CrewHeader
    // component (also used by Kasir/Satgas) once all three role routes
    // converged on the same header/table-section shell; the OwnerUi.tsx
    // page shell (OwnerPage) is still the wrapper underneath it.
    expect(text).toContain('from "@/components/OwnerUi"');
    expect(text).toContain("OwnerPage");
    expect(text).toContain('from "@/components/CrewHeader"');
    expect(text).toContain("<CrewHeader");
  });
});
