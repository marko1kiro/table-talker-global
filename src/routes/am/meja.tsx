import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import { AmRestoTabs } from "@/components/am/AmRestoTabs";
import { loadRestoPick, resolveRestoPick, saveRestoPick } from "@/lib/am-resto-pick";
import {
  amChangeOwnPassword,
  amLogout,
  amScope,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { amBindTableRealtime, amTableSnapshot, type AmTableRow } from "@/lib/am-tables.server";
import { getSupabaseBrowserClient, refreshCarrierToken } from "@/lib/browser-auth";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/meja")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Status Meja - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmMejaPage,
});

type RestoSnapshot = { id: string; tables: AmTableRow[] };

type AmRealtimeChannel = {
  on: (type: "broadcast", filter: { event: string }, callback: () => void) => AmRealtimeChannel;
  subscribe: () => AmRealtimeChannel;
};

function AmMejaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [bindFailed, setBindFailed] = useState(false);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });

  const changePassword = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      amChangeOwnPassword({ data: input }),
  });

  async function handleLogout() {
    await amLogout();
    removeManagerIdentity(browserManagerStorage());
    queryClient.removeQueries({ predicate: (query) => isOwnerQueryKey(query.queryKey) });
    await navigate({ to: "/manager/login" });
  }

  const restos =
    scope.data?.ok === true
      ? scope.data.restaurants.map((r) => ({
          id: String(r.restaurant_id),
          name: String(r.display_name),
        }))
      : [];

  const snapshots = useQuery({
    queryKey: ["am", "table-snapshots", restos.map((r) => r.id).join(",")],
    queryFn: async (): Promise<RestoSnapshot[]> =>
      Promise.all(
        restos.map(async (r) => {
          try {
            const res = await amTableSnapshot({ data: { restaurantId: r.id } });
            if (res.ok) return { id: r.id, tables: res.tables };
          } catch {
            /* per-resto failure degrades to empty grid, never fails the batch */
          }
          return { id: r.id, tables: [] as AmTableRow[] };
        }),
      ),
    enabled: restos.length > 0,
    placeholderData: keepPreviousData,
  });

  const counts = new Map(
    (snapshots.data ?? []).map((s) => [
      s.id,
      {
        terisi: s.tables.filter((t) => t.status === "terisi").length,
        kosong: s.tables.filter((t) => t.status === "kosong").length,
      },
    ]),
  );
  const busiest = [...counts.entries()].sort((a, b) => b[1].terisi - a[1].terisi)[0]?.[0] ?? null;
  const stored = pick ?? loadRestoPick("meja");
  const active = stored
    ? resolveRestoPick(stored, restos)
    : (busiest ?? resolveRestoPick(null, restos));

  const activeTables = [...(snapshots.data?.find((s) => s.id === active)?.tables ?? [])].sort(
    (a, b) => a.tableNumber - b.tableNumber,
  );
  const activeName = restos.find((r) => r.id === active)?.name ?? "";

  // AM tidak pakai useTableOccupancyRealtime: hook mengirim p_session_token, RPC bind_am_table_realtime butuh p_am_id.
  // Maka bind manual via amBindTableRealtime + subscribe channel table-occupancy di bawah.
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let channel: AmRealtimeChannel | null = null;
    setBindFailed(false);
    void (async () => {
      try {
        const accessToken = await refreshCarrierToken();
        if (disposed) return;
        if (!accessToken) {
          setBindFailed(true);
        } else {
          const res = await amBindTableRealtime({ data: { accessToken, restaurantId: active } });
          if (!disposed && !res.ok) setBindFailed(true);
        }
      } catch {
        if (!disposed) setBindFailed(true);
      }
      if (disposed) return;
      const client = getSupabaseBrowserClient() as unknown as {
        channel: (name: string, opts: { config: { private: true } }) => AmRealtimeChannel;
        removeChannel: (c: AmRealtimeChannel) => void;
      } | null;
      if (!client) return;
      channel = client
        .channel(`table-occupancy:${active}`, { config: { private: true } })
        .on("broadcast", { event: "invalidate" }, () => {
          void queryClient.invalidateQueries({ queryKey: ["am", "table-snapshots"] });
        });
      channel.subscribe();
    })();
    return () => {
      disposed = true;
      if (channel) {
        const client = getSupabaseBrowserClient() as unknown as {
          removeChannel: (c: AmRealtimeChannel) => void;
        } | null;
        try {
          client?.removeChannel(channel);
        } catch {
          /* cleanup best-effort */
        }
      }
    };
  }, [active, queryClient]);

  if (!auth.authenticated) {
    return (
      <TaCard title="Sesi Berakhir">
        <p className="text-sm text-slate-500">Silakan login ulang sebagai Area Manager.</p>
        <button
          type="button"
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
          onClick={() => void navigate({ to: "/manager/login" })}
        >
          Ke Login Staf
        </button>
      </TaCard>
    );
  }

  return (
    <AmLayout
      active="/am/meja"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <AmRestoTabs menu="meja" restos={restos} value={pick} onChange={setPick} />

      <TaCard title="Okupansi per Resto" description="Pilih kartu untuk melihat grid meja.">
        {scope.isLoading || snapshots.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Memuat status meja...
          </p>
        ) : restos.length === 0 ? (
          <p className="text-sm text-slate-500">Tidak ada resto dalam scope Anda.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {restos.map((r) => {
              const c = counts.get(r.id) ?? { terisi: 0, kosong: 0 };
              const isActive = active === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      saveRestoPick("meja", r.id);
                      setPick(r.id);
                    }}
                    className={
                      isActive
                        ? "w-full rounded-xl border-2 border-slate-900 bg-slate-50 p-3 text-left"
                        : "w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-400"
                    }
                  >
                    <p className="text-sm font-bold text-slate-900">{r.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Terisi {c.terisi} · Kosong {c.kosong}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </TaCard>

      {active && (
        <TaCard
          title={activeName || "Grid Meja"}
          description="Read-only — pantau saja, tanpa aksi perubahan status."
        >
          {bindFailed && (
            <p role="status" className="mb-3 text-xs font-medium text-amber-600">
              Realtime tidak tersambung — data tetap diperbarui otomatis saat halaman aktif.
            </p>
          )}
          <div className="mb-3 flex items-center gap-4 text-[11px] font-bold uppercase text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              Meja kosong
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              Meja terisi
            </span>
          </div>
          {snapshots.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Memuat grid meja...
            </p>
          ) : snapshots.isError ? (
            <p role="alert" className="text-sm text-red-600">
              Gagal memuat status meja.
            </p>
          ) : activeTables.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada data meja pada resto ini.</p>
          ) : (
            <ul className="grid grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-2.5 md:grid-cols-10 lg:grid-cols-12">
              {activeTables.map((t) => {
                const terisi = t.status === "terisi";
                return (
                  <li key={t.tableNumber}>
                    <span
                      className={`grid aspect-square place-items-center rounded-xl text-sm font-extrabold ${
                        terisi
                          ? "bg-red-600 text-white"
                          : "border-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                      }`}
                    >
                      {t.tableNumber}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </TaCard>
      )}

      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        onSubmit={async (oldPassword, newPassword) => {
          const result = await changePassword.mutateAsync({ oldPassword, newPassword });
          if (result.ok) {
            await handleLogout();
          }
          return result;
        }}
      />
      <EditProfileDialog
        key={auth.fullName}
        open={editProfileOpen}
        currentName={auth.fullName}
        onOpenChange={setEditProfileOpen}
        onSubmit={async (fullName) => {
          const result = await updateOwnAmProfile({ data: { fullName } });
          if (result.ok) await queryClient.invalidateQueries();
          return result;
        }}
      />
    </AmLayout>
  );
}
