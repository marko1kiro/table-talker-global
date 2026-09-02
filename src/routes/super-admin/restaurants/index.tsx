import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CircleAlert, Plus, Radio } from "lucide-react";
import { RestaurantCredentialDialog } from "@/components/RestaurantCredentialDialog";
import {
  OwnerEmpty,
  OwnerLoading,
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  OwnerRetry,
  StatusBadge,
  ownerPrimaryButtonClass,
} from "@/components/OwnerUi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";

export const Route = createFileRoute("/super-admin/restaurants/")({ component: Restaurants });

function Restaurants() {
  const queryClient = useQueryClient();
  const [create, setCreate] = useState(false);
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });

  if (restaurants.isLoading) return <OwnerLoading label="Memuat daftar restoran..." />;
  if (restaurants.isError || !restaurants.data?.ok)
    return (
      <OwnerPage>
        <OwnerPageHeader
          title="Restoran"
          description="Kelola restoran dan pantau kesiapan operasionalnya."
        />
        <OwnerPanel>
          <OwnerNotice role="alert" tone="danger">
            Daftar restoran tidak dapat dimuat.
          </OwnerNotice>
          <div className="mt-4">
            <OwnerRetry onClick={() => restaurants.refetch()} />
          </div>
        </OwnerPanel>
      </OwnerPage>
    );

  const rows = restaurants.data.restaurants as Array<{
    id: string;
    display_name: string;
    is_active: boolean;
    catalog_version: number;
    plays_today: number;
    latest_sync_failure: { report_code: string; occurred_at: string } | null;
  }>;

  return (
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Manajemen Tenant"
        title="Restoran"
        description={`${rows.length} restoran terdaftar. Buka detail untuk mengelola kredensial, perangkat, dan katalog audio.`}
        action={
          <button className={ownerPrimaryButtonClass} type="button" onClick={() => setCreate(true)}>
            <Plus className="size-4" /> Tambah restoran
          </button>
        }
      />

      {rows.length ? (
        <OwnerPanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Restoran</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Katalog</TableHead>
                <TableHead className="text-right">Diputar Hari Ini</TableHead>
                <TableHead>Sinkronisasi</TableHead>
                <TableHead aria-label="Buka detail" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      to="/super-admin/restaurants/$id"
                      params={{ id: row.id }}
                      className="inline-flex items-center gap-2 font-bold text-slate-950 hover:text-amber-700"
                    >
                      {row.display_name}
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.is_active ? "success" : "neutral"}>
                      {row.is_active ? "Aktif" : "Nonaktif"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-semibold text-slate-700">
                    v{row.catalog_version}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-700">
                    {row.plays_today}
                  </TableCell>
                  <TableCell>
                    {row.latest_sync_failure ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700">
                        <CircleAlert className="size-4" /> Sinkron gagal:{" "}
                        {row.latest_sync_failure.report_code}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <Radio className="size-4 text-emerald-500" /> Normal
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/super-admin/restaurants/$id"
                      params={{ id: row.id }}
                      aria-label={`Buka detail ${row.display_name}`}
                      className="inline-flex text-slate-400 transition hover:text-slate-700"
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </OwnerPanel>
      ) : (
        <OwnerPanel>
          <OwnerEmpty
            title="Belum ada restoran"
            description="Tambahkan restoran pertama untuk mulai mengelola perangkat dan audio."
          />
        </OwnerPanel>
      )}

      <RestaurantCredentialDialog
        open={create}
        mode="create"
        onOpenChange={setCreate}
        onComplete={() => void queryClient.invalidateQueries({ queryKey: ["owner-restaurants"] })}
      />
    </OwnerPage>
  );
}
