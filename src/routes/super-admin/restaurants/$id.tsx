import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RestaurantCredentialDialog } from "@/components/RestaurantCredentialDialog";
import { getOwnerRestaurantDetail } from "@/lib/owner-restaurants.server";
import { deactivateRestaurant } from "@/lib/admin-restaurants.server";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/super-admin/restaurants/$id")({
  component: RestaurantDetail,
});

function RestaurantDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [credentialMode, setCredentialMode] = useState<"view" | "rotate" | null>(null);
  const [displayNameConfirmation, setDisplayNameConfirmation] = useState("");
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [deactivateError, setDeactivateError] = useState("");
  const detail = useQuery({
    queryKey: ["owner-restaurant", id],
    queryFn: () => getOwnerRestaurantDetail({ data: { restaurantId: id } }),
  });
  if (detail.isLoading) return <Panel>Memuat resto...</Panel>;
  if (detail.isError || !detail.data || !detail.data.ok)
    return (
      <Panel>
        <p role="alert">Resto tidak dapat dimuat.</p>
        <button type="button" onClick={() => detail.refetch()}>
          Coba Lagi
        </button>
      </Panel>
    );
  const data = detail.data.detail as {
    restaurant: { id: string; display_name: string; is_active: boolean; catalog_version: number };
    catalog: {
      total: number;
      items: Array<{
        audio_id: string;
        label: string;
        category: string;
        active: boolean;
        ordering: number;
      }>;
    };
    recent_playback: Array<{ audio_id: string; status: string; event_timestamp: string }>;
    recent_errors: Array<{ report_code: string; occurred_at: string }>;
    sync_history: Array<{ report_code: string; occurred_at: string }>;
  };
  const restaurant = { id: data.restaurant.id, displayName: data.restaurant.display_name };
  const deactivate = async () => {
    setDeactivateError("");
    const result = await deactivateRestaurant({
      data: { restaurantId: id, displayNameConfirmation, superAdminPassword },
    });
    if ("error" in result) setDeactivateError(result.error ?? "Resto tidak dapat dinonaktifkan.");
    else void queryClient.invalidateQueries({ queryKey: ["owner-restaurant", id] });
  };
  return (
    <Panel>
      <Link to="/super-admin/restaurants">Kembali ke Resto</Link>
      <h1 className="mt-3 font-display text-2xl uppercase">{restaurant.displayName}</h1>
      <p>
        {data.restaurant.is_active ? "Aktif" : "Nonaktif"} · Katalog v
        {data.restaurant.catalog_version}
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => setCredentialMode("view")}>
          Lihat Kode
        </button>
        <button type="button" onClick={() => setCredentialMode("rotate")}>
          Ganti Kode
        </button>
        <Link to="/super-admin/audio" search={{ restaurantId: id }}>
          Kelola Audio
        </Link>
      </div>
      {data.restaurant.is_active && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button">Nonaktifkan Resto</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Nonaktifkan Resto</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini mencabut akses resto.</AlertDialogDescription>
            <h2 className="font-display uppercase">Nonaktifkan Resto</h2>
            <input
              aria-label="Ketik ulang Nama Resto"
              value={displayNameConfirmation}
              onChange={(event) => setDisplayNameConfirmation(event.target.value)}
              placeholder="Ketik ulang Nama Resto"
            />
            <input
              aria-label="Password Super Admin"
              type="password"
              value={superAdminPassword}
              onChange={(event) => setSuperAdminPassword(event.target.value)}
              placeholder="Password Super Admin"
            />
            <AlertDialogAction
              disabled={displayNameConfirmation !== restaurant.displayName}
              onClick={() => void deactivate()}
            >
              Nonaktifkan
            </AlertDialogAction>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            {deactivateError && <p role="alert">{deactivateError}</p>}
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Section title="Katalog">
        <p>{data.catalog.total} item</p>
        <List
          values={data.catalog.items.map(
            (item) =>
              `${item.audio_id} · ${item.label} · ${item.category} · ${item.active ? "aktif" : "nonaktif"} · ${item.ordering}`,
          )}
          empty="Belum ada mapping."
        />
      </Section>
      <Section title="Riwayat Sinkron">
        <List
          values={data.sync_history.map((item) => `${item.report_code} · ${item.occurred_at}`)}
          empty="Belum ada riwayat sinkron."
        />
      </Section>
      <Section title="Pemutaran terbaru">
        <List
          values={data.recent_playback.map(
            (event) => `${event.audio_id} · ${event.status} · ${event.event_timestamp}`,
          )}
          empty="Belum ada pemutaran."
        />
      </Section>
      <Section title="Error terbaru">
        <List
          values={data.recent_errors.map((error) => `${error.report_code} · ${error.occurred_at}`)}
          empty="Belum ada error."
        />
      </Section>
      {credentialMode && (
        <RestaurantCredentialDialog
          open
          mode={credentialMode}
          restaurant={restaurant}
          onOpenChange={(open) => !open && setCredentialMode(null)}
          onComplete={() =>
            void queryClient.invalidateQueries({ queryKey: ["owner-restaurant", id] })
          }
        />
      )}
    </Panel>
  );
}
function Panel({ children }: { children: React.ReactNode }) {
  return <section className="brutal-border bg-card p-6">{children}</section>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="brutal-border mt-4 p-3">
      <h2 className="font-display uppercase">{title}</h2>
      {children}
    </section>
  );
}
function List({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <ul>
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  ) : (
    <p>{empty}</p>
  );
}
