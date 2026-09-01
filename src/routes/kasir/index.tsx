// Task 10: Kasir route. Manual KOSONG -> TERISI marking for counter-paid
// dine-in orders that never scan a QR code. Kasir may only fill a table --
// it never empties one (that is Clear Up's exclusive transition), per the
// design spec's per-role transition table.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { CrewHeader } from "@/components/CrewHeader";
import { TABLE_COUNT } from "@/lib/audio";
import {
  browserSessionStorage,
  readRoleSessionIdentity,
  removeRoleSessionIdentity,
  type RoleSessionIdentity,
} from "@/lib/crew-session-identity";
import { useLayoutPreference } from "@/lib/use-layout-preference";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  getTableOccupancySnapshot,
  setTableOccupiedKasir,
  type TableOccupancyRow,
} from "@/lib/table-occupancy.server";

export const Route = createFileRoute("/kasir/")({ component: KasirRoute });

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
  return tables.find((table) => table.tableNumber === tableNumber)?.status ?? "kosong";
}

function KasirRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<RoleSessionIdentity | null>(null);
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [confirmTable, setConfirmTable] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const { layoutPreference, setLayoutPreference } = useLayoutPreference("kasir");

  // Client-only hydration, same pattern as src/routes/index.tsx: reading
  // sessionStorage during SSR would always return null and mismatch the
  // client's first render.
  useEffect(() => {
    const stored = readRoleSessionIdentity(browserSessionStorage());
    if (!stored || stored.role !== "kasir") {
      void navigate({ to: "/" });
      return;
    }
    setIdentity(stored);
    setIdentityHydrated(true);
  }, [navigate]);

  const restaurantId = identity?.restaurantId ?? "";
  const realtimeStatus = useTableOccupancyRealtime(restaurantId, () => {
    void queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) });
  });

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
    // Realtime is primary; the hook owns the visible-only 12-second fallback.
    refetchOnWindowFocus: true,
  });

  const markOccupied = useMutation({
    mutationFn: async (tableNumber: number) =>
      setTableOccupiedKasir({
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
        return;
      }
      setActionError("");
      setConfirmTable(null);
      void queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) });
    },
  });

  const logout = () => {
    removeRoleSessionIdentity(browserSessionStorage());
    void navigate({ to: "/" });
  };

  if (!identityHydrated || !identity) return null;

  const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];

  return (
    <div className="mx-auto w-full max-w-[1440px] sm:px-6 sm:py-2 lg:px-10 lg:py-4">
      <OwnerPage>
        <CrewHeader
          role="Kasir"
          restaurantName={identity.restaurantDisplayName}
          userName={identity.displayName}
          onLogout={logout}
          sectionTitle="Meja"
          hint="Tap meja KOSONG untuk menandai TERISI setelah pelanggan bayar di kasir."
          legend={[
            { color: "emerald", label: "Kosong" },
            { color: "red", label: "Terisi" },
          ]}
          layoutPreference={layoutPreference}
          onToggleLayout={() => setLayoutPreference(layoutPreference === "grid" ? "list" : "grid")}
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

        {snapshot.isLoading ? (
          <OwnerPanel>
            <p className="text-sm text-slate-500">Memuat status meja...</p>
          </OwnerPanel>
        ) : snapshot.isError || !snapshot.data || !snapshot.data.ok ? (
          <OwnerPanel>
            <OwnerNotice role="alert" tone="danger">
              Status meja tidak dapat dimuat.
            </OwnerNotice>
            <div className="mt-4">
              <OwnerRetry onClick={() => snapshot.refetch()} />
            </div>
          </OwnerPanel>
        ) : layoutPreference === "grid" ? (
          <TableGrid
            tables={tables}
            onSelectEmptyTable={(tableNumber) => setConfirmTable(tableNumber)}
          />
        ) : (
          <TableList
            tables={tables}
            onSelectEmptyTable={(tableNumber) => setConfirmTable(tableNumber)}
          />
        )}

        <AlertDialog
          open={confirmTable !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmTable(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Tandai Meja {confirmTable} Terisi?</AlertDialogTitle>
              <AlertDialogDescription>
                Gunakan ini hanya untuk pelanggan yang bayar langsung di kasir tanpa scan QR.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmTable(null)}>Batal</AlertDialogCancel>
              <AlertDialogAction
                className={ownerPrimaryButtonClass}
                disabled={markOccupied.isPending}
                onClick={() => confirmTable !== null && markOccupied.mutate(confirmTable)}
              >
                Ya, Tandai Terisi
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </OwnerPage>
    </div>
  );
}

function TableGrid({
  tables,
  onSelectEmptyTable,
}: {
  tables: TableOccupancyRow[];
  onSelectEmptyTable: (tableNumber: number) => void;
}) {
  return (
    <OwnerPanel>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-2.5 md:grid-cols-10 lg:grid-cols-12 lg:gap-3 xl:grid-cols-[repeat(15,minmax(0,1fr))] 2xl:grid-cols-[repeat(18,minmax(0,1fr))]">
        {Array.from({ length: TABLE_COUNT }, (_, index) => index + 1).map((tableNumber) => {
          const status = tableStatus(tables, tableNumber);
          const occupied = status === "terisi";
          return (
            <button
              key={tableNumber}
              type="button"
              aria-label={`Meja ${tableNumber}`}
              aria-disabled={occupied}
              disabled={occupied}
              onClick={() => onSelectEmptyTable(tableNumber)}
              className={
                occupied
                  ? "flex aspect-square cursor-not-allowed items-center justify-center rounded-xl border-2 border-red-300 bg-red-50 text-sm font-extrabold text-red-700 lg:text-base"
                  : "flex aspect-square items-center justify-center rounded-xl border-2 border-emerald-300 bg-emerald-50 text-sm font-extrabold text-emerald-800 transition hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-100 hover:shadow-sm active:translate-y-0 lg:text-base"
              }
            >
              {tableNumber}
            </button>
          );
        })}
      </div>
    </OwnerPanel>
  );
}

function TableList({
  tables,
  onSelectEmptyTable,
}: {
  tables: TableOccupancyRow[];
  onSelectEmptyTable: (tableNumber: number) => void;
}) {
  return (
    <OwnerPanel>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: TABLE_COUNT }, (_, index) => index + 1).map((tableNumber) => {
          const status = tableStatus(tables, tableNumber);
          const occupied = status === "terisi";
          return (
            <button
              key={tableNumber}
              type="button"
              aria-label={`Meja ${tableNumber}`}
              aria-disabled={occupied}
              disabled={occupied}
              onClick={() => onSelectEmptyTable(tableNumber)}
              className={
                occupied
                  ? "flex w-full cursor-not-allowed items-center justify-between px-3 py-3 text-left text-sm font-bold text-red-700"
                  : "flex w-full items-center justify-between px-3 py-3 text-left text-sm font-bold text-emerald-800 transition hover:bg-emerald-50"
              }
            >
              <span>Meja {tableNumber}</span>
              <span
                className={
                  occupied
                    ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"
                    : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700"
                }
              >
                {occupied ? "TERISI" : "KOSONG"}
              </span>
            </button>
          );
        })}
      </div>
    </OwnerPanel>
  );
}
