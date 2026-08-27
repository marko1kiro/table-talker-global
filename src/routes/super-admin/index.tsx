import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleX,
  Database,
  HardDrive,
  RefreshCw,
  Radio,
  Users,
  Volume2,
  Wifi,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getOwnerDashboardSnapshot } from "@/lib/owner-dashboard.server";
import { mergeDashboardHealth, type HealthStatus } from "@/lib/owner-dashboard-domain";
import {
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  OwnerRetry,
  ownerSecondaryButtonClass,
} from "@/components/OwnerUi";

const key = ["owner-dashboard"] as const;

export const Route = createFileRoute("/super-admin/")({ component: OwnerDashboard });

function OwnerDashboard() {
  const queryClient = useQueryClient();
  const [realtime, setRealtime] = useState("SUBSCRIBING");
  const [realtimeAttempt, setRealtimeAttempt] = useState(0);
  const snapshot = useQuery({
    queryKey: key,
    queryFn: () => getOwnerDashboardSnapshot(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setRealtime("CHANNEL_ERROR");
      return;
    }
    const channel = client
      .channel("owner-dashboard")
      .on("broadcast", { event: "invalidate" }, () =>
        queryClient.invalidateQueries({ queryKey: key }),
      )
      .subscribe(setRealtime);
    return () => void client.removeChannel(channel);
  }, [queryClient, realtimeAttempt]);

  if (snapshot.isLoading) {
    return (
      <OwnerPage>
        <OwnerPageHeader
          title="Dashboard"
          description="Ringkasan kondisi operasional Table Talker."
        />
        <DashboardSkeleton />
      </OwnerPage>
    );
  }
  if (snapshot.isError || !snapshot.data)
    return (
      <OwnerPage>
        <OwnerPageHeader
          title="Dashboard"
          description="Ringkasan kondisi operasional Table Talker."
        />
        <OwnerPanel>
          <OwnerNotice role="alert" tone="danger">
            Dashboard tidak dapat dimuat.
          </OwnerNotice>
          <div className="mt-4">
            <OwnerRetry onClick={() => snapshot.refetch()} />
          </div>
        </OwnerPanel>
      </OwnerPage>
    );

  const { health, aggregates } = snapshot.data;
  const dashboardHealth = mergeDashboardHealth(health, {
    status: realtime === "SUBSCRIBED" ? "healthy" : "unavailable",
    message: realtime,
  });
  const metrics = aggregates
    ? [
        {
          label: "Total Restoran",
          value: aggregates.total_restaurants,
          to: "/super-admin/restaurants",
          icon: Building2,
          tone: "bg-violet-50 text-violet-700",
        },
        {
          label: "Restoran Aktif",
          value: aggregates.active_restaurants,
          to: "/super-admin/restaurants",
          icon: Activity,
          tone: "bg-emerald-50 text-emerald-700",
        },
        {
          label: "Crew Online",
          value: aggregates.active_crew_devices,
          to: "/super-admin/restaurants",
          icon: Users,
          tone: "bg-sky-50 text-sky-700",
        },
        {
          label: "Diputar Hari Ini",
          value: aggregates.plays_today,
          to: "/super-admin/history",
          icon: Volume2,
          tone: "bg-amber-50 text-amber-700",
        },
        {
          label: "Gagal Sinkron",
          value: aggregates.sync_failures,
          to: "/super-admin/history",
          icon: RefreshCw,
          tone: aggregates.sync_failures ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600",
        },
        {
          label: "Error Terbuka",
          value: aggregates.unresolved_errors,
          to: "/super-admin/error-log",
          icon: CircleX,
          tone: aggregates.unresolved_errors
            ? "bg-red-50 text-red-700"
            : "bg-slate-100 text-slate-600",
        },
      ]
    : [];

  return (
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Pusat Operasional"
        title="Dashboard"
        description="Pantau kesehatan layanan dan aktivitas seluruh restoran dari satu tempat."
        action={
          <button
            type="button"
            onClick={() => snapshot.refetch()}
            className={ownerSecondaryButtonClass}
            disabled={snapshot.isFetching}
          >
            <RefreshCw className={`size-4 ${snapshot.isFetching ? "animate-spin" : ""}`} />
            {snapshot.isFetching ? "Memperbarui" : "Perbarui data"}
          </button>
        }
      />

      {aggregates ? (
        <section
          aria-label="Ringkasan metrik"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
        >
          {metrics.map(({ label, value, to, icon: Icon, tone }) => (
            <Link
              key={label}
              to={to}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`grid size-10 place-items-center rounded-xl ${tone}`}>
                  <Icon className="size-5" />
                </span>
                <ArrowUpRight className="size-4 text-slate-300 transition group-hover:text-slate-700" />
              </div>
              <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{value}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">{label}</p>
            </Link>
          ))}
        </section>
      ) : (
        <OwnerNotice role="status">
          Agregat database tidak tersedia. Status layanan tetap dapat dipantau.
        </OwnerNotice>
      )}

      <OwnerPanel
        title="Kesehatan layanan"
        description="Status koneksi sistem diperbarui otomatis setiap 30 detik."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(dashboardHealth).map(([name, result]) => {
            const healthy = result.status === "healthy";
            const Icon = serviceIcon(name);
            return (
              <article key={name} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-lg bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
                    <Icon className="size-[18px]" />
                  </span>
                  <span
                    className={`flex items-center gap-1.5 text-xs font-extrabold ${healthy ? "text-emerald-700" : "text-red-700"}`}
                  >
                    <span
                      className={`size-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-red-500"}`}
                    />
                    {healthLabel(result)}
                  </span>
                </div>
                <p className="mt-4 font-extrabold text-slate-900">{healthName(name)}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {healthy ? "Layanan berjalan normal." : "Perlu diperiksa kembali."}
                </p>
                {name === "realtime" && !healthy && (
                  <button
                    type="button"
                    onClick={() => {
                      setRealtime("RECOVERING");
                      setRealtimeAttempt((attempt) => attempt + 1);
                    }}
                    className="mt-3 text-xs font-extrabold text-amber-700 hover:text-amber-800"
                  >
                    Sambungkan ulang Realtime
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </OwnerPanel>

      <OwnerPanel className="overflow-hidden bg-slate-950 text-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-400 text-slate-950">
              <Radio className="size-5" />
            </span>
            <div>
              <p className="font-extrabold">Realtime monitoring aktif</p>
              <p className="mt-1 text-sm text-slate-400">
                Perubahan operasional akan masuk tanpa perlu memuat ulang halaman.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/20 sm:self-auto">
            <CircleCheck className="size-4" /> Live
          </span>
        </div>
      </OwnerPanel>
    </OwnerPage>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-36 rounded-2xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

function serviceIcon(name: string) {
  return (
    ({ database: Database, r2: HardDrive, api: Activity, realtime: Wifi } as const)[
      name as "database" | "r2" | "api" | "realtime"
    ] ?? Activity
  );
}

function healthLabel(result: HealthStatus) {
  if (result.status === "healthy") return "Sehat";
  if (result.status === "timeout") return "Waktu habis";
  return "Tidak tersedia";
}

function healthName(name: string) {
  return (
    (
      {
        database: "Database",
        r2: "Penyimpanan R2",
        api: "API & Deployment",
        realtime: "Realtime",
      } as Record<string, string>
    )[name] ?? name
  );
}
