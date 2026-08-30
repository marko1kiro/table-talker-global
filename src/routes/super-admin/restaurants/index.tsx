import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, CircleAlert, Plus, Radio, Volume2 } from "lucide-react";
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
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                    <Building2 className="size-5" />
                  </span>
                  <StatusBadge tone={row.is_active ? "success" : "neutral"}>
                    {row.is_active ? "Aktif" : "Nonaktif"}
                  </StatusBadge>
                </div>
                <Link
                  to="/super-admin/restaurants/$id"
                  params={{ id: row.id }}
                  className="mt-4 inline-flex items-center gap-2 text-lg font-black text-slate-950 hover:text-amber-700"
                >
                  {row.display_name}
                  <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                </Link>
                <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 text-center">
                  <div>
                    <p className="text-lg font-black text-slate-900">v{row.catalog_version}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Katalog
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-900">{row.plays_today}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Diputar
                    </p>
                  </div>
                </div>
              </div>
              {row.latest_sync_failure ? (
                <div className="flex items-center gap-2 border-t border-red-100 bg-red-50 px-5 py-3 text-xs font-bold text-red-700">
                  <CircleAlert className="size-4" /> Sinkron gagal:{" "}
                  {row.latest_sync_failure.report_code}
                </div>
              ) : (
                <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-xs font-semibold text-slate-500">
                  <Radio className="size-4 text-emerald-500" /> Sinkronisasi normal{" "}
                  <span className="ml-auto flex items-center gap-1">
                    <Volume2 className="size-3.5" /> {row.plays_today} hari ini
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
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
