import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CrewHeader } from "@/components/CrewHeader";
import { ManagerLayout, type ManagerMenu } from "@/components/ManagerLayout";
import { OwnerEmpty, OwnerNotice, OwnerRetry } from "@/components/OwnerUi";
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

export const Route = createFileRoute("/manager/")({
  head: () => ({
    meta: [{ title: "Dashboard Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerDashboard,
});

function snapshotKey(id: string) {
  return ["manager-snapshot", id] as const;
}

function ManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<ManagerIdentity | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [menu, setMenu] = useState<ManagerMenu>("tables");
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

  return (
    <ManagerLayout
      restaurantCode={identity.restaurantCode}
      restaurantName={identity.restaurantDisplayName}
      active={menu}
      onSelect={setMenu}
      header={
        <CrewHeader
          role="Manager"
          restaurantName={identity.restaurantDisplayName}
          restaurantCode={identity.restaurantCode}
          userName={identity.fullName}
          onLogout={logout}
          notice={notices.current}
        />
      }
    >
      {realtimeStatus !== "SUBSCRIBED" && (
        <OwnerNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis.
        </OwnerNotice>
      )}

      {reminder && (
        <div className="mb-4 overflow-hidden rounded-xl bg-red-600 px-3 py-2 text-white">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide">{reminder}</p>
        </div>
      )}

      {menu === "tables" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-4 text-[11px] font-bold uppercase">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              Kosong
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              Terisi
            </span>
          </div>
          {snapshot.isLoading ? (
            <p className="text-sm text-slate-500">Memuat status meja...</p>
          ) : snapshot.isError || !snapshot.data || !snapshot.data.ok ? (
            <>
              <OwnerNotice role="alert" tone="danger">
                Status meja tidak dapat dimuat.
              </OwnerNotice>
              <div className="mt-3">
                <OwnerRetry onClick={() => snapshot.refetch()} />
              </div>
            </>
          ) : (
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {tables.map((t) => {
                const terisi = t.status === "terisi";
                return (
                  <li
                    key={t.tableNumber}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-3"
                  >
                    <span
                      className={`text-sm font-extrabold uppercase md:hidden ${terisi ? "text-red-600" : "text-emerald-600"}`}
                    >
                      MEJA {t.tableNumber}
                    </span>
                    <span className="hidden md:flex items-center gap-3">
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-lg text-base font-black text-white ${terisi ? "bg-red-500" : "bg-emerald-500"}`}
                      >
                        {t.tableNumber}
                      </span>
                      <span
                        className={`text-sm font-extrabold uppercase ${terisi ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {terisi ? "PERLU DIBERSIHKAN" : "SIAP DIGUNAKAN"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {menu === "crew" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {crew.isLoading && <p className="text-sm text-slate-500">Memuat crew...</p>}
          {crew.data &&
            crew.data.ok &&
            (() => {
              const groups = groupActiveCrewByStation(crew.data.crew);
              const maxRows = Math.max(1, ...groups.map((g) => g.members.length));
              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[11px] uppercase text-slate-500">
                        {groups.map((g) => (
                          <th
                            key={g.label}
                            colSpan={2}
                            className="border border-slate-200 px-3 py-2 text-center font-black"
                          >
                            {g.label}
                          </th>
                        ))}
                      </tr>
                      <tr className="text-[11px] uppercase text-slate-400">
                        {groups.map((g) => (
                          <Fragment key={g.label}>
                            <th className="border border-slate-200 px-3 py-1 text-left">
                              Nama Crew
                            </th>
                            <th className="border border-slate-200 px-3 py-1 text-left">
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
                                <td className="border border-slate-100 px-3 py-2 font-bold text-slate-800">
                                  {m?.displayName ?? ""}
                                </td>
                                <td className="border border-slate-100 px-3 py-2 text-slate-600">
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
              );
            })()}
        </section>
      )}

      {menu === "log" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-black uppercase text-slate-900">Log Aktivitas Crew</h3>
          {log.length === 0 ? (
            <OwnerEmpty
              title="Belum ada aktivitas"
              description="Aktivitas perubahan status meja akan muncul di sini selama halaman terbuka."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {log.map((n, i) => (
                <li
                  key={`${n.line1}-${i}`}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-bold uppercase text-slate-800">{n.line1}</span>
                  <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {n.roleLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </ManagerLayout>
  );
}
