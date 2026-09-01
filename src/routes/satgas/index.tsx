// Task 11: Satgas route. Read-only occupancy grid + Escort Intent flow.
// Satgas never mutates table status directly -- per the design spec's
// per-role transition table it may only create escort intents
// (create_escort_intent) and, once an intent's 10-minute window has
// elapsed with the table still KOSONG, confirm it (confirm_escort_intent)
// to mark the table TERISI. It must never call the Kasir/Clear Up
// occupancy-mutating RPC wrappers directly -- those remain their
// exclusive transitions respectively.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  OwnerNotice,
  OwnerPage,
  OwnerPanel,
  OwnerRetry,
  ownerPrimaryButtonClass,
} from "@/components/OwnerUi";
import { CrewHeader, CrewTableSection } from "@/components/CrewHeader";
import { TABLE_COUNT } from "@/lib/audio";
import {
  browserSessionStorage,
  readRoleSessionIdentity,
  removeRoleSessionIdentity,
  type RoleSessionIdentity,
} from "@/lib/crew-session-identity";
import { useLayoutPreference } from "@/lib/use-layout-preference";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import {
  getLiveAccessToken,
  getSupabaseBrowserClient,
} from "@/lib/supabase-browser";
import {
  confirmEscortIntent,
  createEscortIntent,
  getTableOccupancySnapshot,
  type TableOccupancyRow,
} from "@/lib/table-occupancy.server";
import {
  ESCORT_INTENT_WINDOW_MS,
  addEscortWaitEntry,
  partitionEscortWaitlist,
  readEscortWaitlist,
  removeEscortWaitEntry,
  type EscortWaitEntry,
} from "@/lib/satgas-escort-waitlist";

export const Route = createFileRoute("/satgas/")({ component: SatgasRoute });

function snapshotQueryKey(restaurantId: string) {
  return ["table-occupancy-snapshot", restaurantId] as const;
}

// KOSONG for every table not (yet) present in the snapshot response --
// mirrors the RPC's own default so a table that has genuinely never been
// touched still renders as tappable rather than looking broken.
function tableStatus(
  tables: TableOccupancyRow[],
  tableNumber: number,
): TableOccupancyRow["status"] {
  return (
    tables.find((table) => table.tableNumber === tableNumber)?.status ??
    "kosong"
  );
}

function SatgasRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<RoleSessionIdentity | null>(null);
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [escortTable, setEscortTable] = useState<number | null>(null);
  // Tracks the table whose escort action is in flight, independent of
  // `escortTable`. The confirmation dialog is meant to close the instant
  // its button is tapped (default AlertDialogAction behaviour), which
  // clears `escortTable` right away -- so the "still processing" signal
  // for the table grid/list has to live in its own piece of state,
  // cleared once the escort intent has actually been created (the point
  // at which the table visibly flips to "Sudah Di-escort" below).
  const [processingTable, setProcessingTable] = useState<number | null>(null);
  const [waitlist, setWaitlist] = useState<EscortWaitEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState("");
  const { layoutPreference, setLayoutPreference } =
    useLayoutPreference("satgas");

  // Client-only hydration, same pattern as Kasir/src/routes/index.tsx:
  // reading sessionStorage during SSR would always return null and
  // mismatch the client's first render. The escort waitlist is hydrated
  // in the same effect, scoped to this exact session's roleSessionId, so
  // a fresh login (new roleSessionId) never inherits a previous session's
  // pending intents.
  useEffect(() => {
    const stored = readRoleSessionIdentity(browserSessionStorage());
    if (!stored || stored.role !== "satgas") {
      void navigate({ to: "/" });
      return;
    }
    setIdentity(stored);
    setWaitlist(
      readEscortWaitlist(browserSessionStorage(), stored.roleSessionId),
    );
    setIdentityHydrated(true);
  }, [navigate]);

  // Client-side-only 1-second tick so the "ready to confirm" prompt
  // appears the moment an intent's 10-minute window elapses, per the
  // spec's "no extra server polling beyond the existing occupancy
  // snapshot/realtime feed" cost philosophy -- this timer never itself
  // calls the server.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const restaurantId = identity?.restaurantId ?? "";
  const realtimeStatus = useTableOccupancyRealtime(restaurantId, () => {
    void queryClient.invalidateQueries({
      queryKey: snapshotQueryKey(restaurantId),
    });
  });

  const snapshot = useQuery({
    queryKey: snapshotQueryKey(restaurantId),
    queryFn: async () =>
      getTableOccupancySnapshot({
        data: {
          restaurantId,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(
            getSupabaseBrowserClient(),
            identity!.accessToken,
          ),
        },
      }),
    enabled: Boolean(identity),
    // Realtime is primary; the hook owns the visible-only 12-second fallback.
    refetchOnWindowFocus: true,
  });

  const tables = useMemo(
    () => (snapshot.data && snapshot.data.ok ? snapshot.data.tables : []),
    [snapshot.data],
  );

  // An intent resolved by something other than this Satgas confirming it
  // -- a customer's own QR scan, or Kasir marking the table occupied --
  // must disappear with no prompt, per spec. Keyed on the live snapshot
  // (not the 1-second tick) so this only re-runs when occupancy actually
  // changes; each removal shrinks `waitlist`, so the effect is
  // self-terminating rather than looping.
  useEffect(() => {
    if (!identity || !snapshot.data || !snapshot.data.ok) return;
    const currentTables = snapshot.data.tables;
    const resolvedElsewhere = waitlist.filter(
      (entry) => tableStatus(currentTables, entry.tableNumber) === "terisi",
    );
    if (resolvedElsewhere.length === 0) return;
    let next = waitlist;
    for (const entry of resolvedElsewhere) {
      next = removeEscortWaitEntry(
        browserSessionStorage(),
        identity.roleSessionId,
        entry.intentId,
      );
    }
    setWaitlist(next);
  }, [snapshot.data, identity, waitlist]);

  const partition = useMemo(
    () => partitionEscortWaitlist(waitlist, tables, now),
    [waitlist, tables, now],
  );

  // Tables with a pending (not yet auto-cleared) escort intent render
  // KUNING instead of hijau, so Satgas can see at a glance which KOSONG
  // tables it has already escorted. Sourced from the same waitlist/
  // partition used for the confirm prompt -- a table leaves this set the
  // instant it's autoCleared (became terisi) or its intent is confirmed/
  // removed, never needing separate tracking.
  const escortedTableNumbers = useMemo(
    () =>
      new Set(
        [...partition.stillWaiting, ...partition.readyToConfirm].map(
          (entry) => entry.tableNumber,
        ),
      ),
    [partition],
  );

  const escortMutation = useMutation({
    mutationFn: async (tableNumber: number) => {
      const result = await createEscortIntent({
        data: {
          restaurantId,
          tableNumber,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(
            getSupabaseBrowserClient(),
            identity!.accessToken,
          ),
        },
      });
      return { result, tableNumber };
    },
    onSuccess: ({ result, tableNumber }) => {
      if (!result.ok) {
        setActionError(result.message);
        setProcessingTable(null);
        return;
      }
      setActionError("");
      setWaitlist(
        addEscortWaitEntry(browserSessionStorage(), identity!.roleSessionId, {
          intentId: result.intentId,
          tableNumber,
          expiresAt: Date.now() + ESCORT_INTENT_WINDOW_MS,
        }),
      );
      // Unlike Kasir/Clear Up, escorting a table doesn't change its
      // occupancy status on the server -- it only adds a local waitlist
      // entry (handled just above), which is what flips this table to
      // "Sudah Di-escort" below. That update is synchronous, so the
      // banner can clear immediately rather than waiting on a refetch.
      setProcessingTable(null);
    },
    onError: () => {
      setActionError("Gagal mencatat escort. Coba lagi.");
      setProcessingTable(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (entry: EscortWaitEntry) => {
      const result = await confirmEscortIntent({
        data: {
          intentId: entry.intentId,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(
            getSupabaseBrowserClient(),
            identity!.accessToken,
          ),
        },
      });
      return { result, entry };
    },
    onSuccess: ({ result, entry }) => {
      if (result.ok || result.code === "ALREADY_OCCUPIED") {
        // Either genuinely confirmed here, or another role/scan beat us
        // to occupying the table -- either way this intent no longer
        // needs a prompt.
        setActionError("");
        setWaitlist(
          removeEscortWaitEntry(
            browserSessionStorage(),
            identity!.roleSessionId,
            entry.intentId,
          ),
        );
        void queryClient.invalidateQueries({
          queryKey: snapshotQueryKey(restaurantId),
        });
        return;
      }
      if (result.code === "INTENT_NOT_FOUND") {
        // Most likely just this device's clock running a little ahead of
        // the server's, so the RPC hasn't yet agreed the window elapsed.
        // Leave the entry queued and let the next tick retry rather than
        // surfacing a false error to Satgas.
        return;
      }
      setActionError(result.message);
    },
  });

  const logout = () => {
    removeRoleSessionIdentity(browserSessionStorage());
    void navigate({ to: "/" });
  };

  if (!identityHydrated || !identity) return null;

  return (
    <OwnerPage>
      <CrewHeader
        role="Satgas"
        restaurantName={identity.restaurantDisplayName}
        userName={identity.displayName}
        onLogout={logout}
      />

      {realtimeStatus !== "SUBSCRIBED" && (
        <OwnerNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis setiap
          beberapa detik.
        </OwnerNotice>
      )}

      {actionError && (
        <OwnerNotice role="alert" tone="danger">
          {actionError}
        </OwnerNotice>
      )}

      {partition.readyToConfirm.length > 0 && (
        <OwnerPanel
          title="Menunggu Konfirmasi"
          description="Sudah 10 menit sejak diantar dan meja masih tercatat kosong. Konfirmasi jika tamu sudah duduk."
        >
          <div className="flex flex-col gap-2">
            {partition.readyToConfirm.map((entry) => {
              const isConfirming =
                confirmMutation.isPending &&
                confirmMutation.variables?.intentId === entry.intentId;
              return (
                <div
                  key={entry.intentId}
                  className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
                >
                  <span className="text-sm font-bold text-amber-800">
                    Meja {entry.tableNumber}
                  </span>
                  <button
                    type="button"
                    disabled={confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate(entry)}
                    className={`${ownerPrimaryButtonClass} flex items-center gap-2`}
                  >
                    {isConfirming && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {isConfirming ? "Memproses..." : "Konfirmasi"}
                  </button>
                </div>
              );
            })}
          </div>
        </OwnerPanel>
      )}

      <CrewTableSection
        legend={[
          { color: "emerald", label: "Kosong" },
          { color: "amber", label: "Sudah Di-escort" },
          { color: "red", label: "Terisi" },
        ]}
        layoutPreference={layoutPreference}
        onToggleLayout={() =>
          setLayoutPreference(layoutPreference === "grid" ? "list" : "grid")
        }
      >
        {processingTable !== null && (
          <OwnerNotice role="status" tone="neutral">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Memproses escort Meja {processingTable}...
            </span>
          </OwnerNotice>
        )}

        {snapshot.isLoading ? (
          <p className="text-sm text-slate-500">Memuat status meja...</p>
        ) : snapshot.isError || !snapshot.data || !snapshot.data.ok ? (
          <>
            <OwnerNotice role="alert" tone="danger">
              Status meja tidak dapat dimuat.
            </OwnerNotice>
            <div className="mt-4">
              <OwnerRetry onClick={() => snapshot.refetch()} />
            </div>
          </>
        ) : layoutPreference === "grid" ? (
          <TableGrid
            tables={tables}
            escortedTableNumbers={escortedTableNumbers}
            pendingTable={processingTable}
            onSelectEmptyTable={(tableNumber) => setEscortTable(tableNumber)}
          />
        ) : (
          <TableList
            tables={tables}
            escortedTableNumbers={escortedTableNumbers}
            pendingTable={processingTable}
            onSelectEmptyTable={(tableNumber) => setEscortTable(tableNumber)}
          />
        )}
      </CrewTableSection>

      <AlertDialog
        open={escortTable !== null}
        onOpenChange={(open) => {
          if (!open) setEscortTable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Escort ke Meja {escortTable}?</AlertDialogTitle>
            <AlertDialogDescription>
              Meja ini akan diingatkan untuk dikonfirmasi 10 menit lagi jika
              belum berubah statusnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEscortTable(null)}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className={ownerPrimaryButtonClass}
              onClick={() => {
                // AlertDialogAction closes the dialog on click by default
                // (Radix wraps it in a Dialog.Close) -- that's exactly
                // what we want here. The "sedang diproses" signal moves
                // to the table grid/list instead, via `processingTable`,
                // which is set here so it survives the dialog closing.
                if (escortTable !== null) {
                  setProcessingTable(escortTable);
                  escortMutation.mutate(escortTable);
                }
              }}
            >
              Ya, Escort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OwnerPage>
  );
}

function TableGrid({
  tables,
  escortedTableNumbers,
  pendingTable,
  onSelectEmptyTable,
}: {
  tables: TableOccupancyRow[];
  escortedTableNumbers: Set<number>;
  pendingTable: number | null;
  onSelectEmptyTable: (tableNumber: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
      {Array.from({ length: TABLE_COUNT }, (_, index) => index + 1).map(
        (tableNumber) => {
          const status = tableStatus(tables, tableNumber);
          const occupied = status === "terisi";
          const escorted = !occupied && escortedTableNumbers.has(tableNumber);
          const isPending = pendingTable === tableNumber;
          return (
            <button
              key={tableNumber}
              type="button"
              aria-label={`Meja ${tableNumber}`}
              aria-disabled={occupied || isPending}
              disabled={occupied || isPending}
              onClick={() => onSelectEmptyTable(tableNumber)}
              className={
                occupied
                  ? "flex aspect-square cursor-not-allowed items-center justify-center rounded-xl border-2 border-red-300 bg-red-50 text-sm font-extrabold text-red-700 transition-colors duration-300"
                  : escorted
                    ? "flex aspect-square items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-50 text-sm font-extrabold text-amber-800 transition-colors duration-300 hover:border-amber-400 hover:bg-amber-100"
                    : isPending
                      ? "flex aspect-square cursor-wait items-center justify-center rounded-xl border-2 border-emerald-300 bg-emerald-50 text-sm font-extrabold text-emerald-800 transition-colors duration-300"
                      : "flex aspect-square items-center justify-center rounded-xl border-2 border-emerald-300 bg-emerald-50 text-sm font-extrabold text-emerald-800 transition-colors duration-300 hover:border-emerald-400 hover:bg-emerald-100"
              }
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                tableNumber
              )}
            </button>
          );
        },
      )}
    </div>
  );
}

function TableList({
  tables,
  escortedTableNumbers,
  pendingTable,
  onSelectEmptyTable,
}: {
  tables: TableOccupancyRow[];
  escortedTableNumbers: Set<number>;
  pendingTable: number | null;
  onSelectEmptyTable: (tableNumber: number) => void;
}) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: TABLE_COUNT }, (_, index) => index + 1).map(
        (tableNumber) => {
          const status = tableStatus(tables, tableNumber);
          const occupied = status === "terisi";
          const escorted = !occupied && escortedTableNumbers.has(tableNumber);
          const isPending = pendingTable === tableNumber;
          return (
            <button
              key={tableNumber}
              type="button"
              aria-label={`Meja ${tableNumber}`}
              aria-disabled={occupied || isPending}
              disabled={occupied || isPending}
              onClick={() => onSelectEmptyTable(tableNumber)}
              className={
                occupied
                  ? "flex w-full cursor-not-allowed items-center justify-between px-3 py-3 text-left text-sm font-bold text-red-700 transition-colors duration-300"
                  : escorted
                    ? "flex w-full items-center justify-between px-3 py-3 text-left text-sm font-bold text-amber-800 transition-colors duration-300 hover:bg-amber-50"
                    : isPending
                      ? "flex w-full cursor-wait items-center justify-between px-3 py-3 text-left text-sm font-bold text-emerald-800 transition-colors duration-300"
                      : "flex w-full items-center justify-between px-3 py-3 text-left text-sm font-bold text-emerald-800 transition-colors duration-300 hover:bg-emerald-50"
              }
            >
              <span>Meja {tableNumber}</span>
              {isPending ? (
                <Loader2 className="size-4 animate-spin text-emerald-700" />
              ) : (
                <span
                  className={
                    occupied
                      ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"
                      : escorted
                        ? "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700"
                        : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700"
                  }
                >
                  {occupied ? "TERISI" : escorted ? "DI-ESCORT" : "KOSONG"}
                </span>
              )}
            </button>
          );
        },
      )}
    </div>
  );
}
