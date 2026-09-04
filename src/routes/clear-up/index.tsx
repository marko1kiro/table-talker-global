// Task 12: Clear Up route. Manual TERISI -> KOSONG marking after Clear Up
// staff physically observe a table is clean. Clear Up may only empty a
// table -- it never fills one (that is Kasir's/Satgas's exclusive
// transition), per the design spec's per-role transition table.
//
// Unlike Kasir/Satgas (which always render all TABLE_COUNT slots so a
// still-KOSONG table isn't lost from the grid), this route only ever
// cares about the currently-TERISI subset: a table that has never been
// TERISI never appears here, and the list/grid is sorted/highlighted by
// how long a table has been occupied so far -- longest-waiting first --
// computed entirely client-side from `occupied_at` via the pure
// `sortedOccupiedTables` helper and a 1-second `setInterval` tick, with
// zero additional server calls beyond the existing snapshot/realtime feed
// (see src/lib/clear-up-queue.ts).
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
import { OwnerEmpty, OwnerNotice, OwnerPage, OwnerRetry } from "@/components/OwnerUi";
import {
  CrewHeader,
  CrewTableSection,
  crewPrimaryButtonClass,
  crewSecondaryButtonClass,
} from "@/components/CrewHeader";
import {
  browserSessionStorage,
  readRoleSessionIdentity,
  removeRoleSessionIdentity,
  type RoleSessionIdentity,
} from "@/lib/crew-session-identity";
import { useLayoutPreference } from "@/lib/use-layout-preference";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import { useNoticeQueue } from "@/hooks/use-notice-queue";
import { formatOccupancyNotice } from "@/lib/occupancy-notice";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  formatOccupiedDuration,
  sortedOccupiedTables,
  type OccupiedTableEntry,
} from "@/lib/clear-up-queue";
import { getTableOccupancySnapshot, setTableEmptyCleanup } from "@/lib/table-occupancy.server";

export const Route = createFileRoute("/clear-up/")({ component: ClearUpRoute });

function snapshotQueryKey(restaurantId: string) {
  return ["table-occupancy-snapshot", restaurantId] as const;
}

function ClearUpRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<RoleSessionIdentity | null>(null);
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [confirmTable, setConfirmTable] = useState<number | null>(null);
  // Tracks the table whose status change is in flight, independent of
  // `confirmTable`. The confirmation dialog is meant to close the instant
  // its button is tapped (default AlertDialogAction behaviour), which
  // clears `confirmTable` right away -- so the "still processing" signal
  // for the table grid/list has to live in its own piece of state, kept
  // alive until the snapshot query has actually refetched the new status.
  const [processingTable, setProcessingTable] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const { layoutPreference, setLayoutPreference } = useLayoutPreference("clear_up");

  // Client-only hydration, same pattern as Kasir/Satgas: reading
  // sessionStorage during SSR would always return null and mismatch the
  // client's first render.
  useEffect(() => {
    const stored = readRoleSessionIdentity(browserSessionStorage());
    if (!stored || stored.role !== "clear_up") {
      void navigate({ to: "/" });
      return;
    }
    setIdentity(stored);
    setIdentityHydrated(true);
  }, [navigate]);

  // Client-side-only 1-second tick so each table's occupied-duration
  // badge counts up live, per the spec's "zero additional server or DB
  // cost" cost philosophy -- this timer never itself calls the server or
  // touches the snapshot query.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const restaurantId = identity?.restaurantId ?? "";
  const snapshot = useQuery({
    queryKey: snapshotQueryKey(restaurantId),
    queryFn: async () =>
      getTableOccupancySnapshot({
        data: {
          restaurantId,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    enabled: Boolean(identity),
    // Realtime is primary; the hook also owns the visible-only 12-second safety net.
    refetchOnWindowFocus: true,
  });
  const notices = useNoticeQueue();
  const realtimeStatus = useTableOccupancyRealtime(
    restaurantId,
    identity?.roleSessionToken ?? "",
    snapshot.data?.ok ? snapshot.data.revision : null,
    () => {
      void queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) });
    },
    identity?.roleSessionId ?? null,
    (broadcast) => {
      const notice = formatOccupancyNotice(broadcast);
      if (notice) notices.push(notice);
    },
  );

  const queue = useMemo(() => {
    const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
    return sortedOccupiedTables(tables, now);
  }, [snapshot.data, now]);

  const markEmpty = useMutation({
    mutationFn: async (tableNumber: number) =>
      setTableEmptyCleanup({
        data: {
          restaurantId,
          tableNumber,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setActionError(result.message);
        setProcessingTable(null);
        return;
      }
      setActionError("");
      // Keep the "sedang diproses" banner up until the snapshot has
      // actually refetched, so it stays visible for the whole stretch
      // between the dialog closing and the table's status truly
      // flipping on screen -- not just for the mutation call itself.
      void queryClient
        .invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) })
        .then(() => setProcessingTable(null));
    },
    onError: () => {
      setActionError("Gagal mengubah status meja. Coba lagi.");
      setProcessingTable(null);
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
        role="Clear Up"
        restaurantName={identity.restaurantDisplayName}
        restaurantCode={identity.restaurantCode}
        userName={identity.displayName}
        onLogout={logout}
        notice={notices.current}
      />

      {realtimeStatus !== "SUBSCRIBED" && (
        <OwnerNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis setiap beberapa detik.
        </OwnerNotice>
      )}

      {actionError && (
        <OwnerNotice role="alert" tone="danger">
          {actionError}
        </OwnerNotice>
      )}

      <CrewTableSection
        legend={[{ color: "red", label: "Perlu Dibersihkan" }]}
        layoutPreference={layoutPreference}
        onToggleLayout={() => setLayoutPreference(layoutPreference === "grid" ? "list" : "grid")}
      >
        {processingTable !== null && (
          <OwnerNotice role="status" tone="neutral">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Memproses Meja {processingTable}...
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
        ) : queue.length === 0 ? (
          <OwnerEmpty
            title="Tidak ada meja yang perlu dibersihkan"
            description="Semua meja saat ini KOSONG. Daftar ini otomatis muncul begitu ada meja TERISI."
          />
        ) : layoutPreference === "grid" ? (
          <TableGrid
            queue={queue}
            pendingTable={processingTable}
            onSelectTable={(tableNumber) => setConfirmTable(tableNumber)}
          />
        ) : (
          <TableList
            queue={queue}
            pendingTable={processingTable}
            onSelectTable={(tableNumber) => setConfirmTable(tableNumber)}
          />
        )}
      </CrewTableSection>

      <AlertDialog
        open={confirmTable !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tandai Meja {confirmTable} Sudah Dibersihkan?</AlertDialogTitle>
            <AlertDialogDescription>
              Gunakan ini hanya setelah meja benar-benar selesai dibersihkan dan siap dipakai
              kembali.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className={crewSecondaryButtonClass}
              onClick={() => setConfirmTable(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className={crewPrimaryButtonClass}
              onClick={() => {
                // AlertDialogAction closes the dialog on click by default
                // (Radix wraps it in a Dialog.Close) -- that's exactly
                // what we want here. The "sedang diproses" signal moves
                // to the table grid/list instead, via `processingTable`,
                // which is set here so it survives the dialog closing.
                if (confirmTable !== null) {
                  setProcessingTable(confirmTable);
                  markEmpty.mutate(confirmTable);
                }
              }}
            >
              Ya, Tandai Kosong
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OwnerPage>
  );
}

function TableGrid({
  queue,
  pendingTable,
  onSelectTable,
}: {
  queue: OccupiedTableEntry[];
  pendingTable: number | null;
  onSelectTable: (tableNumber: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
      {queue.map((entry) => {
        const isPending = pendingTable === entry.tableNumber;
        return (
          <button
            key={entry.tableNumber}
            type="button"
            aria-label={`Meja ${entry.tableNumber}`}
            aria-disabled={isPending}
            disabled={isPending}
            onClick={() => onSelectTable(entry.tableNumber)}
            className={
              isPending
                ? "flex aspect-square cursor-wait flex-col items-center justify-center gap-1 rounded-xl border-2 border-red-300 bg-red-50 text-red-700 transition-colors duration-300"
                : "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-red-300 bg-red-50 text-red-700 transition-colors duration-300 hover:border-red-400 hover:bg-red-100"
            }
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm font-extrabold">{entry.tableNumber}</span>
                <span className="text-[11px] font-bold text-red-600">
                  {formatOccupiedDuration(entry.durationMs)}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TableList({
  queue,
  pendingTable,
  onSelectTable,
}: {
  queue: OccupiedTableEntry[];
  pendingTable: number | null;
  onSelectTable: (tableNumber: number) => void;
}) {
  return (
    <div className="divide-y divide-slate-100">
      {queue.map((entry) => {
        const isPending = pendingTable === entry.tableNumber;
        return (
          <button
            key={entry.tableNumber}
            type="button"
            aria-label={`Meja ${entry.tableNumber}`}
            aria-disabled={isPending}
            disabled={isPending}
            onClick={() => onSelectTable(entry.tableNumber)}
            className={
              isPending
                ? "flex w-full cursor-wait items-center justify-between px-3 py-3 text-left text-sm font-bold text-red-700 transition-colors duration-300"
                : "flex w-full items-center justify-between px-3 py-3 text-left text-sm font-bold text-red-700 transition-colors duration-300 hover:bg-red-50"
            }
          >
            <span>Meja {entry.tableNumber}</span>
            {isPending ? (
              <Loader2 className="size-4 animate-spin text-red-700" />
            ) : (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                {formatOccupiedDuration(entry.durationMs)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
