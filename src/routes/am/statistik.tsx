import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard, TaStatCard, taControlClass } from "@/components/dashboard/ui";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AmLayout } from "@/components/am/AmLayout";
import { AmRestoTabs } from "@/components/am/AmRestoTabs";
import { loadRestoPick, resolveRestoPick } from "@/lib/am-resto-pick";
import { wibDateKey } from "@/lib/crew-history-scope";
import {
  amChangeOwnPassword,
  amLogout,
  amScope,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { amTableSnapshot, amTableStats, type AmTableRow } from "@/lib/am-tables.server";
import { pastWibDates } from "@/lib/am-trend";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/statistik")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Statistik - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmStatistikPage,
});

function AmStatistikPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [date, setDate] = useState(() => wibDateKey());

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
    queryFn: async (): Promise<{ id: string; tables: AmTableRow[] }[]> =>
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
        total: s.tables.length,
      },
    ]),
  );
  const busiest = [...counts.entries()].sort((a, b) => b[1].terisi - a[1].terisi)[0]?.[0] ?? null;
  const stored = pick ?? loadRestoPick("statistik");
  const active = stored
    ? resolveRestoPick(stored, restos)
    : (busiest ?? resolveRestoPick(null, restos));

  const stats = useQuery({
    queryKey: ["am", "table-stats", active, date],
    queryFn: () => {
      if (!active) throw new Error("no resto");
      return amTableStats({ data: { restaurantId: active, date } });
    },
    enabled: active !== null && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: keepPreviousData,
  });

  const trendDates = /^\d{4}-\d{2}-\d{2}$/.test(date) ? pastWibDates(date, 7) : [];
  const trend = useQuery({
    queryKey: ["am", "table-trend", active, date],
    queryFn: async (): Promise<{ date: string; tamu: number }[]> =>
      Promise.all(
        trendDates.map(async (d) => {
          try {
            if (!active) throw new Error("no resto");
            const res = await amTableStats({ data: { restaurantId: active, date: d } });
            if (res.ok) return { date: d, tamu: res.totalServed };
          } catch {
            /* per-date failure degrades to 0, never fails the batch */
          }
          return { date: d, tamu: 0 };
        }),
      ),
    enabled: active !== null && trendDates.length === 7,
    placeholderData: keepPreviousData,
  });

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

  const chartData =
    stats.data?.ok === true
      ? [...stats.data.perTable]
          .sort((a, b) => a.tableNumber - b.tableNumber)
          .map((t) => ({ meja: `M${t.tableNumber}`, terisi: t.timesOccupied }))
      : [];

  return (
    <AmLayout
      active="/am/statistik"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <AmRestoTabs menu="statistik" restos={restos} value={pick} onChange={setPick} />

      <TaCard title="Statistik Harian" description="Served, peak, dan tren per meja.">
        <label className="block max-w-xs text-sm font-medium text-slate-700">
          Tanggal (WIB)
          <input
            type="date"
            value={date}
            max={wibDateKey()}
            onChange={(e) => setDate(e.target.value)}
            className={taControlClass}
          />
        </label>

        {stats.isLoading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Memuat statistik...
          </p>
        ) : stats.data && !stats.data.ok ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            Gagal memuat statistik.
          </p>
        ) : stats.data?.ok ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <TaStatCard label="Total Served" value={stats.data.totalServed} compact />
              <TaStatCard
                label="Peak Hour"
                value={
                  stats.data.peakHour !== null
                    ? `${String(stats.data.peakHour).padStart(2, "0")}:00`
                    : "-"
                }
                compact
              />
              <TaStatCard
                label="Okupansi Kini"
                value={
                  active && counts.get(active)
                    ? `${counts.get(active)!.terisi}/${counts.get(active)!.total} meja`
                    : "-"
                }
                compact
              />
            </div>

            <div className="mt-4">
              <ChartContainer
                config={{ terisi: { label: "Kali terisi", color: "#0ea5e9" } }}
                className="min-h-[220px] w-full"
              >
                <BarChart data={chartData}>
                  <XAxis dataKey="meja" />
                  <YAxis allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="terisi" fill="var(--color-terisi)" radius={4} />
                </BarChart>
              </ChartContainer>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold text-slate-900">Tren 7 hari (tamu/hari)</p>
              {trend.isLoading ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" /> Memuat tren...
                </p>
              ) : trend.isError ? (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  Gagal memuat tren.
                </p>
              ) : (
                <ChartContainer
                  config={{ tamu: { label: "Tamu", color: "#10b981" } }}
                  className="mt-2 min-h-[220px] w-full"
                >
                  <LineChart data={trend.data ?? []}>
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="tamu"
                      stroke="var(--color-tamu)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-400">
                    <th className="border border-black/10 px-3 py-1 text-center">No. Meja</th>
                    <th className="border border-black/10 px-3 py-1 text-center">Kali Terisi</th>
                    <th className="border border-black/10 px-3 py-1 text-center">Total Durasi</th>
                    <th className="border border-black/10 px-3 py-1 text-center">Avg Durasi</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.data.perTable.map((t) => (
                    <tr key={t.tableNumber} className="text-slate-800">
                      <td className="border border-black/10 px-3 py-2 text-center font-bold">
                        {t.tableNumber}
                      </td>
                      <td className="border border-black/10 px-3 py-2 text-center">
                        {t.timesOccupied}
                      </td>
                      <td className="border border-black/10 px-3 py-2 text-center">
                        {t.totalMinutes > 0 ? `${t.totalMinutes}m` : "-"}
                      </td>
                      <td className="border border-black/10 px-3 py-2 text-center">
                        {t.avgMinutes !== null ? `${t.avgMinutes}m` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </TaCard>

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
