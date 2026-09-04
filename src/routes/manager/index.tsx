import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { ManagerLayout, type ManagerMenu } from "@/components/ManagerLayout";
import { TaCard, TaNotice, TaEmpty, TaRetry, TaStatCard } from "@/components/dashboard/ui";
import {
  browserManagerStorage,
  readManagerIdentity,
  removeManagerIdentity,
  type ManagerIdentity,
} from "@/lib/manager-session-identity";
import { getManagerSnapshot, getManagerActiveCrew } from "@/lib/manager-dashboard.server";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import { useNoticeQueue } from "@/hooks/use-notice-queue";
import { formatOccupancyNotice, type OccupancyNotice } from "@/lib/occupancy-notice";
import { buildStaleReminders, rotateIndex } from "@/lib/manager-reminder";
import { groupActiveCrewByStation, formatWibClock } from "@/lib/manager-crew-groups";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { TABLE_COUNT } from "@/lib/audio";

export const Route = createFileRoute("/manager/")({
  head: () => ({
    meta: [{ title: "Dashboard Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerDashboard,
});

function snapshotKey(id: string) {
  return ["manager-snapshot", id] as const;
}

// Desktop-only toast slot with a reserved height so the layout never shifts
// when a live notice arrives. Mobile keeps the AppShell header banner (md:hidden).
function ToastSlot({ notice }: { notice: OccupancyNotice | null }) {
  return (
    <div className="mb-4 hidden min-h-[3.5rem] items-center rounded-xl border border-brand-100 bg-brand-50/60 px-4 md:flex">
      {notice ? (
        <p className="truncate text-sm font-semibold uppercase text-brand-700">
          {notice.line1}
          <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold text-white">
            {notice.roleLabel}
          </span>
        </p>
      ) : (
        <p className="text-sm font-medium text-ta-gray-400 opacity-60">
          Belum ada perubahan status meja
        </p>
      )}
    </div>
  );
}

function ManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<ManagerIdentity | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [menu, setMenu] = useState<ManagerMenu>("tables");
  const [activeStation, setActiveStation] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<OccupancyNotice[]>([]);
  const notices = useNoticeQueue();

  useEffect(() => {
    const stored = readManagerIdentity(browserManagerStorage());
    if (!stored) {
      void navigate({ to: "/manager/login" });
      return;
    }
    setIdentity(stored);
    setHydrated(true);
  }, [navigate]);

  // 1s tick recomputes reminder ages locally; 7s tick rotates the reminder line.
  useEffect(() => {
    const a = setInterval(() => setNow(Date.now()), 1_000);
    const b = setInterval(() => setTick((t) => t + 1), 7_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const restaurantId = identity?.restaurantId ?? "";
  const snapshot = useQuery({
    queryKey: snapshotKey(restaurantId),
    queryFn: async () =>
      getManagerSnapshot({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    enabled: Boolean(identity),
    refetchOnWindowFocus: true,
  });
  const crew = useQuery({
    queryKey: ["manager-crew", restaurantId],
    queryFn: async () =>
      getManagerActiveCrew({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    enabled: Boolean(identity) && menu === "crew",
  });

  const realtimeStatus = useTableOccupancyRealtime(
    restaurantId,
    identity?.managerToken ?? "",
    snapshot.data?.ok ? snapshot.data.revision : null,
    () => {
      void queryClient.invalidateQueries({ queryKey: snapshotKey(restaurantId) });
    },
    null,
    (broadcast) => {
      const notice = formatOccupancyNotice(broadcast);
      if (notice) {
        notices.push(notice);
        setLog((prev) => [notice, ...prev].slice(0, 100));
      }
    },
    "bind_manager_session_realtime",
  );

  const reminders = useMemo(() => {
    const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
    return buildStaleReminders(tables, now);
  }, [snapshot.data, now]);
  const reminder = reminders.length ? reminders[rotateIndex(reminders.length, tick)] : "";

  const logout = () => {
    removeManagerIdentity(browserManagerStorage());
    void navigate({ to: "/manager/login" });
  };

  if (!hydrated || !identity) return null;

  const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
  const statusByNumber = new Map(tables.map((t) => [t.tableNumber, t.status] as const));

  return (
    <ManagerLayout
      restaurantName={identity.restaurantDisplayName}
      active={menu}
      onSelect={setMenu}
      notice={notices.current}
      headerRight={
        <button
          type="button"
          onClick={logout}
          aria-label="Keluar"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ta-gray-300 bg-white px-3 text-sm font-semibold text-ta-gray-700 hover:bg-ta-gray-50"
        >
          <LogOut className="size-4" /> Keluar
        </button>
      }
    >
      {realtimeStatus !== "SUBSCRIBED" && (
        <TaNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis.
        </TaNotice>
      )}

      {reminder && (
        <div className="mb-4 overflow-hidden rounded-xl bg-ta-error px-3 py-2 text-white">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide">{reminder}</p>
        </div>
      )}

      {menu === "tables" && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <TaStatCard
              compact
              label="Terisi"
              value={tables.filter((t) => t.status === "terisi").length}
            />
            <TaStatCard
              compact
              label="Kosong"
              value={tables.filter((t) => t.status === "kosong").length}
            />
            <TaStatCard compact label="Perlu Dicek" value={reminders.length} />
          </div>
          <ToastSlot notice={notices.current} />
          <TaCard>
            <div className="mb-3 flex items-center gap-4 text-[11px] font-bold uppercase text-ta-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-ta-success" />
                MEJA KOSONG
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-ta-error" />
                MEJA TERISI
              </span>
            </div>
            {snapshot.isLoading ? (
              <p className="text-sm text-ta-gray-500">Memuat status meja...</p>
            ) : snapshot.isError || !snapshot.data || !snapshot.data.ok ? (
              <>
                <TaNotice role="alert" tone="danger">
                  Status meja tidak dapat dimuat.
                </TaNotice>
                <div className="mt-3">
                  <TaRetry onClick={() => snapshot.refetch()} />
                </div>
              </>
            ) : (
              <ul className="mx-auto grid w-fit grid-cols-5 gap-2 md:w-full md:grid-cols-10">
                {Array.from({ length: TABLE_COUNT }, (_, i) => i + 1).map((n) => {
                  const terisi = statusByNumber.get(n) === "terisi";
                  return (
                    <li key={n} className="flex items-center justify-center">
                      <span
                        className={`grid size-10 place-items-center rounded-lg text-base font-black ${
                          terisi
                            ? "border-2 border-ta-error/30 bg-ta-error/10 text-ta-error md:border-0 md:bg-ta-error md:text-white"
                            : "border-2 border-ta-success/30 bg-ta-success/10 text-ta-success md:border-0 md:bg-ta-success md:text-white"
                        }`}
                      >
                        {n}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </TaCard>
        </>
      )}

      {menu === "crew" && (
        <>
          <ToastSlot notice={notices.current} />
          <TaCard>
            {crew.isLoading && <p className="text-sm text-ta-gray-500">Memuat crew...</p>}
            {crew.data &&
              crew.data.ok &&
              (() => {
                const groups = groupActiveCrewByStation(crew.data.crew);
                const maxRows = Math.max(1, ...groups.map((g) => g.members.length));
                const STATION_BG = [
                  "bg-sky-500",
                  "bg-amber-500",
                  "bg-violet-500",
                  "bg-emerald-500",
                ];
                const current = groups[activeStation] ?? groups[0];
                return (
                  <>
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="text-[11px] uppercase">
                            {groups.map((g, gi) => (
                              <th
                                key={g.label}
                                colSpan={2}
                                className={`border border-black/10 px-3 py-2 text-center font-black text-white ${STATION_BG[gi]}`}
                              >
                                {g.label}
                              </th>
                            ))}
                          </tr>
                          <tr className="text-[11px] uppercase text-ta-gray-400">
                            {groups.map((g) => (
                              <Fragment key={g.label}>
                                <th className="border border-black/10 px-3 py-1 text-center">
                                  Nama Crew
                                </th>
                                <th className="border border-black/10 px-3 py-1 text-center">
                                  Jam Masuk
                                </th>
                              </Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: maxRows }).map((_, r) => (
                            <tr key={r}>
                              {groups.map((g) => {
                                const m = g.members[r];
                                return (
                                  <Fragment key={g.label}>
                                    <td className="border border-black/10 px-3 py-2 text-center font-bold uppercase text-ta-gray-800">
                                      {m?.displayName ?? ""}
                                    </td>
                                    <td className="border border-black/10 px-3 py-2 text-center text-ta-gray-600">
                                      {m ? formatWibClock(m.checkedInAt) : ""}
                                    </td>
                                  </Fragment>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="md:hidden">
                      <div className="grid grid-cols-2 gap-2">
                        {groups.map((g, gi) => (
                          <button
                            key={g.label}
                            type="button"
                            onClick={() => setActiveStation(gi)}
                            className={`min-h-11 rounded-xl px-3 py-2 text-xs font-black uppercase text-white transition ${
                              activeStation === gi ? STATION_BG[gi] : "bg-ta-gray-300"
                            }`}
                          >
                            {g.label}
                          </button>
                        ))}
                      </div>
                      <table className="mt-3 w-full border-collapse text-sm">
                        <thead>
                          <tr className="text-[11px] uppercase text-ta-gray-400">
                            <th className="border border-black/10 px-3 py-1 text-center">
                              Nama Crew
                            </th>
                            <th className="border border-black/10 px-3 py-1 text-center">
                              Jam Masuk
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {current && current.members.length > 0 ? (
                            current.members.map((m, i) => (
                              <tr key={`${m.displayName}-${i}`}>
                                <td className="border border-black/10 px-3 py-2 text-center font-bold uppercase text-ta-gray-800">
                                  {m.displayName}
                                </td>
                                <td className="border border-black/10 px-3 py-2 text-center text-ta-gray-600">
                                  {formatWibClock(m.checkedInAt)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={2}
                                className="border border-black/10 px-3 py-3 text-center text-xs text-ta-gray-400"
                              >
                                Tidak ada crew aktif.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
          </TaCard>
        </>
      )}

      {menu === "log" && (
        <>
          <ToastSlot notice={notices.current} />
          <TaCard title="Log Aktivitas Crew">
            {log.length === 0 ? (
              <TaEmpty
                title="Belum ada aktivitas"
                description="Aktivitas perubahan status meja akan muncul di sini selama halaman terbuka."
              />
            ) : (
              <ul className="divide-y divide-ta-gray-200">
                {log.map((n, i) => (
                  <li
                    key={`${n.line1}-${i}`}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-bold uppercase text-ta-gray-800">{n.line1}</span>
                    <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      {n.roleLabel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TaCard>
        </>
      )}
    </ManagerLayout>
  );
}
