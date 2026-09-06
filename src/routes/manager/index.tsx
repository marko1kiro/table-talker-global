import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ManagerLayout, type ManagerMenu } from "@/components/ManagerLayout";
import { TaCard, TaNotice, TaEmpty, TaRetry, TaStatCard } from "@/components/dashboard/ui";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";
import {
  browserManagerStorage,
  readManagerIdentity,
  removeManagerIdentity,
  type ManagerIdentity,
} from "@/lib/manager-session-identity";
import { getManagerSnapshot, getManagerCrewHistory } from "@/lib/manager-dashboard.server";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import { useNotificationCenter } from "@/hooks/use-notification-center";
import { formatOccupancyNotice } from "@/lib/occupancy-notice";
import { buildStaleNotices } from "@/lib/manager-reminder";
import { groupActiveCrewByStation, formatWibClock } from "@/lib/manager-crew-groups";
import {
  crewEmptyText,
  formatScopeDate,
  scopeQueryKey,
  scopeToParams,
  wibDateKey,
  type CrewScope,
} from "@/lib/crew-history-scope";
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

function crewScopePillClass(active: boolean) {
  return `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold uppercase transition ${
    active
      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
      : "border-ta-gray-200 bg-white text-ta-gray-500 hover:border-brand-300 hover:text-brand-500 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-400"
  }`;
}

function MobileStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-ta-gray-200 bg-white px-2 py-1.5 text-center shadow-theme-sm dark:border-ta-gray-700 dark:bg-ta-gray-800">
      <p className={`truncate text-[10px] font-bold uppercase ${color}`}>{label}</p>
      <p className={`text-lg leading-tight font-black ${color}`}>{value}</p>
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
  const [crewScope, setCrewScope] = useState<CrewScope>({ kind: "today" });
  const [calOpen, setCalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { items, unread, push, markRead } = useNotificationCenter();
  const [stuck, setStuck] = useState(false);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readManagerIdentity(browserManagerStorage());
    if (!stored) {
      void navigate({ to: "/manager/login" });
      return;
    }
    setIdentity(stored);
    setHydrated(true);
  }, [navigate]);

  // 1s tick recomputes stale-table ages locally.
  useEffect(() => {
    const a = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(a);
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
    queryKey: ["manager-crew-history", restaurantId, scopeQueryKey(crewScope)],
    queryFn: async () =>
      getManagerCrewHistory({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
          ...scopeToParams(crewScope),
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
      if (notice) push(notice);
    },
    "bind_manager_session_realtime",
  );

  const staleNotices = useMemo(() => {
    const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
    return buildStaleNotices(tables, now);
  }, [snapshot.data, now]);

  // Mobile only: once the stat cards scroll up under the sticky header, flip
  // `stuck` so the compact single-row badge pins below the header. The header
  // is ~49px tall, so the root is inset by that amount.
  useEffect(() => {
    if (menu !== "tables") {
      setStuck(false);
      return;
    }
    const el = cardsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: "-49px 0px 0px 0px",
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [menu]);

  const logout = () => {
    removeManagerIdentity(browserManagerStorage());
    void navigate({ to: "/manager/login" });
  };

  if (!hydrated || !identity) return null;

  const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
  const statusByNumber = new Map(tables.map((t) => [t.tableNumber, t.status] as const));
  // The snapshot only returns tables that have an occupancy row; the grid
  // renders all TABLE_COUNT slots and treats a missing table as kosong. Count
  // terisi from the rows and derive kosong so the cards match the grid.
  const terisiCount = tables.filter((t) => t.status === "terisi").length;

  return (
    <ManagerLayout
      restaurantName={identity.restaurantDisplayName}
      active={menu}
      onSelect={setMenu}
      headerRight={
        <DashboardHeaderRight
          roleLabel="MANAGER"
          profile={{ name: identity.fullName, idManager: identity.idManager }}
          notifications={{ stale: staleNotices, feed: items, unread, onOpen: markRead }}
          onLogout={logout}
        />
      }
    >
      {realtimeStatus !== "SUBSCRIBED" && (
        <TaNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis.
        </TaNotice>
      )}

      {menu === "tables" && (
        <>
          <div className="mb-3 hidden grid-cols-3 gap-2 md:grid">
            <TaStatCard compact label="Terisi" value={terisiCount} />
            <TaStatCard compact label="Kosong" value={TABLE_COUNT - terisiCount} />
            <TaStatCard compact label="Perlu Dicek" value={staleNotices.length} />
          </div>
          <div ref={cardsRef} className="mb-3 grid grid-cols-3 gap-2 md:hidden">
            <MobileStat label="Terisi" value={terisiCount} color="text-ta-error" />
            <MobileStat label="Kosong" value={TABLE_COUNT - terisiCount} color="text-ta-success" />
            <MobileStat label="Perlu Dicek" value={staleNotices.length} color="text-ta-warning" />
          </div>
          {stuck && (
            <div className="fixed inset-x-0 top-[49px] z-20 md:hidden">
              <div className="flex items-center justify-center gap-2 border-b border-ta-gray-200 bg-white/95 px-3 py-1 text-[11px] font-bold uppercase shadow-theme-sm backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95">
                <span className="text-ta-error">Terisi {terisiCount}</span>
                <span className="text-ta-gray-300 dark:text-ta-gray-600">|</span>
                <span className="text-ta-success">Kosong {TABLE_COUNT - terisiCount}</span>
                <span className="text-ta-gray-300 dark:text-ta-gray-600">|</span>
                <span className="text-ta-warning">Perlu Dicek {staleNotices.length}</span>
              </div>
            </div>
          )}
          <TaCard>
            <div className="mb-3 flex items-center gap-4 text-[11px] font-bold uppercase text-ta-gray-500 dark:text-ta-gray-400">
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
              <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
                Memuat status meja...
              </p>
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
              <ul className="grid grid-cols-5 gap-2 md:grid-cols-10">
                {Array.from({ length: TABLE_COUNT }, (_, i) => i + 1).map((n) => {
                  const terisi = statusByNumber.get(n) === "terisi";
                  return (
                    <li key={n}>
                      <span
                        className={`grid aspect-square place-items-center rounded-xl text-sm font-extrabold lg:text-base ${
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
          <TaCard>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCrewScope({ kind: "today" })}
                className={crewScopePillClass(crewScope.kind === "today")}
              >
                Hari ini
              </button>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className={crewScopePillClass(crewScope.kind === "date")}>
                    <CalendarDays className="size-4" />
                    {crewScope.kind === "date" ? formatScopeDate(crewScope.date) : "Pilih Tanggal"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={localeId}
                    selected={
                      crewScope.kind === "date"
                        ? parseISO(crewScope.date)
                        : crewScope.kind === "today"
                          ? parseISO(wibDateKey())
                          : undefined
                    }
                    defaultMonth={crewScope.kind === "date" ? parseISO(crewScope.date) : undefined}
                    onSelect={(d) => {
                      if (!d) return;
                      const key = wibDateKey(d);
                      setCalOpen(false);
                      setCrewScope(
                        key === wibDateKey() ? { kind: "today" } : { kind: "date", date: key },
                      );
                    }}
                  />
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => setCrewScope({ kind: "all" })}
                className={crewScopePillClass(crewScope.kind === "all")}
              >
                Semua
              </button>
            </div>
            {crew.isLoading && (
              <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">Memuat crew...</p>
            )}
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
                                    <td
                                      className={`border border-black/10 px-3 py-2 text-center font-bold uppercase ${
                                        m && !m.isActive
                                          ? "text-ta-gray-400 dark:text-ta-gray-500"
                                          : "text-ta-gray-800 dark:text-ta-gray-100"
                                      }`}
                                    >
                                      {m?.displayName ?? ""}
                                      {m?.isActive && (
                                        <span className="ml-1 inline-flex rounded-full bg-ta-success/15 px-1.5 py-0.5 align-middle text-[9px] font-black uppercase text-ta-success">
                                          AKTIF
                                        </span>
                                      )}
                                    </td>
                                    <td className="border border-black/10 px-3 py-2 text-center text-ta-gray-600 dark:text-ta-gray-300">
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
                                <td
                                  className={`border border-black/10 px-3 py-2 text-center font-bold uppercase ${
                                    m.isActive
                                      ? "text-ta-gray-800 dark:text-ta-gray-100"
                                      : "text-ta-gray-400 dark:text-ta-gray-500"
                                  }`}
                                >
                                  {m.displayName}
                                  {m.isActive && (
                                    <span className="ml-1 inline-flex rounded-full bg-ta-success/15 px-1.5 py-0.5 align-middle text-[9px] font-black uppercase text-ta-success">
                                      AKTIF
                                    </span>
                                  )}
                                </td>
                                <td className="border border-black/10 px-3 py-2 text-center text-ta-gray-600 dark:text-ta-gray-300">
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
                                {crewEmptyText(crewScope)}
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
          <TaCard title="Log Aktivitas Crew">
            {items.length === 0 ? (
              <TaEmpty
                title="Belum ada aktivitas"
                description="Aktivitas perubahan status meja akan muncul di sini selama halaman terbuka."
              />
            ) : (
              <ul className="divide-y divide-ta-gray-200 dark:divide-ta-gray-700">
                {items.map((n, i) => (
                  <li
                    key={`${n.line1}-${i}`}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-bold uppercase text-ta-gray-800 dark:text-ta-gray-100">
                      {n.line1}
                    </span>
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
