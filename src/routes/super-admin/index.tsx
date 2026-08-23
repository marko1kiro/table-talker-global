import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getOwnerDashboardSnapshot } from "@/lib/owner-dashboard.server";

const key = ["owner-dashboard"] as const;

export const Route = createFileRoute("/super-admin/")({ component: OwnerDashboard });

function OwnerDashboard() {
  const queryClient = useQueryClient();
  const [realtime, setRealtime] = useState("SUBSCRIBING");
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
  }, [queryClient]);

  if (snapshot.isLoading) return <Panel title="Dashboard">Memuat status operasi...</Panel>;
  if (snapshot.isError || !snapshot.data)
    return (
      <Panel title="Dashboard">
        <p role="alert">Dashboard tidak dapat dimuat.</p>
        <Retry onClick={() => snapshot.refetch()} />
      </Panel>
    );

  const { health, aggregates } = snapshot.data;
  const metrics = aggregates
    ? [
        ["Total Resto", aggregates.total_restaurants],
        ["Resto Aktif", aggregates.active_restaurants],
        ["Crew Aktif", aggregates.active_crew_devices],
        ["Putar Hari Ini", aggregates.plays_today],
        ["Gagal Sinkron", aggregates.sync_failures],
        ["Error Belum Selesai", aggregates.unresolved_errors],
      ]
    : [];
  return (
    <Panel title="Dashboard">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries({
          ...health,
          realtime: {
            status: realtime === "SUBSCRIBED" ? "healthy" : "unavailable",
            message: realtime,
          },
        } as Record<string, { status: string; message?: string }>).map(([name, result]) => (
          <div key={name} className="brutal-border p-3">
            <p className="font-display uppercase">{name}</p>
            <p
              className={
                result.status === "healthy"
                  ? "font-bold text-green-700"
                  : "font-bold text-destructive"
              }
            >
              {result.status === "healthy" ? "Sehat" : (result.message ?? "Tidak tersedia")}
            </p>
          </div>
        ))}
      </div>
      {aggregates ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map(([label, value]) => (
            <div key={label} className="brutal-border bg-accent/20 p-4">
              <p className="text-xs font-bold uppercase">{label}</p>
              <p className="mt-2 font-display text-3xl">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="brutal-border mt-6 p-3" role="status">
          Agregat database tidak tersedia. Status lain tetap aktif.
        </p>
      )}
      {snapshot.isFetching && <p className="mt-4 text-sm">Memperbarui...</p>}
      <Retry onClick={() => snapshot.refetch()} />
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="brutal-border brutal-shadow-lg bg-card p-4 sm:p-6">
      <h1 className="font-display text-2xl uppercase">{title}</h1>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Retry({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="brutal-border brutal-press mt-5 bg-accent px-3 py-2 font-display uppercase"
    >
      Coba Lagi
    </button>
  );
}
