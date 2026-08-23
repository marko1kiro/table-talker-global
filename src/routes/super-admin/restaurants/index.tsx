import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RestaurantCredentialDialog } from "@/components/RestaurantCredentialDialog";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
export const Route = createFileRoute("/super-admin/restaurants/")({ component: Restaurants });
function Restaurants() {
  const queryClient = useQueryClient();
  const [create, setCreate] = useState(false);
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  if (restaurants.isLoading)
    return <section className="brutal-border bg-card p-6">Memuat resto...</section>;
  if (restaurants.isError || !restaurants.data?.ok)
    return (
      <section className="brutal-border bg-card p-6">
        <p role="alert">Resto tidak dapat dimuat.</p>
        <button type="button" onClick={() => restaurants.refetch()}>
          Coba Lagi
        </button>
      </section>
    );
  const rows = restaurants.data.restaurants as Array<{
    id: string;
    display_name: string;
    is_active: boolean;
    online_devices: number;
    catalog_version: number;
    plays_today: number;
  }>;
  return (
    <section className="brutal-border bg-card p-6">
      <h1 className="font-display text-2xl uppercase">Resto</h1>
      <button className="mt-3" type="button" onClick={() => setCreate(true)}>
        Buat Resto
      </button>
      {rows.length ? (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="brutal-border p-3">
              <Link to="/super-admin/restaurants/$id" params={{ id: row.id }}>
                {row.display_name}
              </Link>
              <p>
                {row.is_active ? "Aktif" : "Nonaktif"} · {row.online_devices} online · katalog v
                {row.catalog_version} · {row.plays_today} putar hari ini
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3">Belum ada resto.</p>
      )}
      <RestaurantCredentialDialog
        open={create}
        mode="create"
        onOpenChange={setCreate}
        onComplete={() => void queryClient.invalidateQueries({ queryKey: ["owner-restaurants"] })}
      />
    </section>
  );
}
