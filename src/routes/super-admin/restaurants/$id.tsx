import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RestaurantCredentialDialog } from "@/components/RestaurantCredentialDialog";
import { getOwnerRestaurantDetail } from "@/lib/owner-restaurants.server";
import { deactivateRestaurant } from "@/lib/admin-restaurants.server";
import {
  OwnerLoading,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  StatusBadge,
  ownerDangerButtonClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/OwnerUi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const dateTimeFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatWaktu(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormat.format(parsed);
}

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
  if (detail.isLoading) return <OwnerLoading label="Memuat detail resto..." />;
  if (detail.isError || !detail.data || !detail.data.ok)
    return (
      <OwnerPage>
        <OwnerPanel>
          <p role="alert" className="text-sm font-bold text-red-700">
            Resto tidak dapat dimuat.
          </p>
          <div className="mt-4">
            <button
              type="button"
              className={ownerSecondaryButtonClass}
              onClick={() => detail.refetch()}
            >
              Coba Lagi
            </button>
          </div>
        </OwnerPanel>
      </OwnerPage>
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
    <OwnerPage>
      <Link
        to="/super-admin/restaurants"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-800"
      >
        ← Kembali ke Restoran
      </Link>

      <OwnerPageHeader
        eyebrow="Detail Restoran"
        title={restaurant.displayName}
        description={`Katalog v${data.restaurant.catalog_version}. Kelola kredensial, audio, dan status operasional resto ini.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={ownerSecondaryButtonClass}
              onClick={() => setCredentialMode("view")}
            >
              Lihat Kode
            </button>
            <button
              type="button"
              className={ownerSecondaryButtonClass}
              onClick={() => setCredentialMode("rotate")}
            >
              Ganti Kode
            </button>
            <Link
              to="/super-admin/audio"
              search={{ restaurantId: id }}
              className={ownerPrimaryButtonClass}
            >
              Kelola Audio
            </Link>
            {data.restaurant.is_active && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className={ownerDangerButtonClass}>
                    Nonaktifkan Resto
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Nonaktifkan Resto</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tindakan ini mencabut akses resto.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-slate-700">
                      Ketik ulang Nama Resto
                      <input
                        aria-label="Ketik ulang Nama Resto"
                        value={displayNameConfirmation}
                        onChange={(event) => setDisplayNameConfirmation(event.target.value)}
                        placeholder="Ketik ulang Nama Resto"
                        className="mt-2 min-h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                      />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">
                      Password Super Admin
                      <input
                        aria-label="Password Super Admin"
                        type="password"
                        value={superAdminPassword}
                        onChange={(event) => setSuperAdminPassword(event.target.value)}
                        placeholder="Password Super Admin"
                        className="mt-2 min-h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                      />
                    </label>
                    {deactivateError && (
                      <p
                        role="alert"
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700"
                      >
                        {deactivateError}
                      </p>
                    )}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      className={ownerDangerButtonClass}
                      disabled={displayNameConfirmation !== restaurant.displayName}
                      onClick={() => void deactivate()}
                    >
                      Nonaktifkan
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <StatusBadge tone={data.restaurant.is_active ? "success" : "neutral"}>
          {data.restaurant.is_active ? "Aktif" : "Nonaktif"}
        </StatusBadge>
      </div>

      <OwnerPanel title="Katalog" description={`${data.catalog.total} item mapping audio.`}>
        {data.catalog.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Audio ID</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Urutan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.catalog.items.map((item) => (
                <TableRow key={item.audio_id}>
                  <TableCell className="font-mono text-xs">{item.audio_id}</TableCell>
                  <TableCell className="font-semibold">{item.label}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>
                    <StatusBadge tone={item.active ? "success" : "neutral"}>
                      {item.active ? "aktif" : "nonaktif"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{item.ordering}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-500">Belum ada mapping.</p>
        )}
      </OwnerPanel>

      <OwnerPanel title="Riwayat Sinkron">
        {data.sync_history.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sync_history.map((item) => (
                <TableRow key={`${item.report_code}-${item.occurred_at}`}>
                  <TableCell className="font-mono text-xs">{item.report_code}</TableCell>
                  <TableCell className="text-slate-600">{formatWaktu(item.occurred_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-500">Belum ada riwayat sinkron.</p>
        )}
      </OwnerPanel>

      <OwnerPanel title="Pemutaran Terbaru">
        {data.recent_playback.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Audio ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_playback.map((event) => (
                <TableRow key={`${event.audio_id}-${event.event_timestamp}`}>
                  <TableCell className="font-mono text-xs">{event.audio_id}</TableCell>
                  <TableCell>{event.status}</TableCell>
                  <TableCell className="text-slate-600">
                    {formatWaktu(event.event_timestamp)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-500">Belum ada pemutaran.</p>
        )}
      </OwnerPanel>

      <OwnerPanel title="Error Terbaru">
        {data.recent_errors.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_errors.map((error) => (
                <TableRow key={`${error.report_code}-${error.occurred_at}`}>
                  <TableCell className="font-mono text-xs text-red-700">
                    {error.report_code}
                  </TableCell>
                  <TableCell className="text-slate-600">{formatWaktu(error.occurred_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-500">Belum ada error.</p>
        )}
      </OwnerPanel>

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
    </OwnerPage>
  );
}
