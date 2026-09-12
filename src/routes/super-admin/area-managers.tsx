import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { TaCard } from "@/components/dashboard/ui";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  saAmRolloutReadiness,
  saAreaManagers,
  saAssignAreaManager,
  saCreateAreaManager,
  saDecideAmReset,
  saPendingAmResets,
  saRevokeAreaManagerAssignment,
  saSetAreaManagerStatus,
  type AreaManagerRow,
} from "@/lib/area-manager.server";
import { saRenameStaff } from "@/lib/super-admin-auth.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";

export const Route = createFileRoute("/super-admin/area-managers")({
  head: () => ({ meta: [{ title: "Area Manager - Console" }] }),
  component: AreaManagersPage,
});

function activeRestaurantsOf(row: AreaManagerRow): string[] {
  return row.area_manager_assignments
    .filter((a) => a.removed_at === null)
    .map((a) => String(a.restaurant_id));
}

function AreaManagersPage() {
  const queryClient = useQueryClient();
  const ams = useQuery({ queryKey: ["sa", "ams"], queryFn: () => saAreaManagers() });
  const readiness = useQuery({
    queryKey: ["sa", "am-readiness"],
    queryFn: () => saAmRolloutReadiness(),
  });
  const restaurants = useQuery({
    queryKey: ["sa", "restaurants"],
    queryFn: () => listOwnerRestaurants(),
  });
  const pendingResets = useQuery({
    queryKey: ["sa", "am-resets"],
    queryFn: () => saPendingAmResets(),
  });

  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sa"] });
  };

  const create = useMutation({
    mutationFn: () =>
      saCreateAreaManager({
        data: { staffId: staffId.trim(), fullName: fullName.trim(), password },
      }),
    onSuccess: (result) => {
      setFeedback(
        result.ok
          ? "Area Manager dibuat."
          : result.code === "INDIVIDUAL_REQUIRED"
            ? "Perlu login Super Admin individual."
            : `Gagal: ${result.code ?? "error"}`,
      );
      if (result.ok) {
        setStaffId("");
        setFullName("");
        setPassword("");
        invalidate();
      }
    },
  });
  const assign = useMutation({
    mutationFn: (input: { amId: string; restaurantId: string }) =>
      saAssignAreaManager({
        data: { areaManagerId: input.amId, restaurantId: input.restaurantId },
      }),
    onSuccess: (result) => {
      if (!result.ok) setFeedback(`Gagal assign: ${result.code ?? "error"}`);
      invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: (input: { amId: string; restaurantId: string }) =>
      saRevokeAreaManagerAssignment({
        data: { areaManagerId: input.amId, restaurantId: input.restaurantId },
      }),
    onSuccess: (result) => {
      if (!result.ok && result.code === "LAST_ACTIVE_AREA_MANAGER") {
        setFeedback("Ditolak: restoran akan kehilangan seluruh Area Manager aktif.");
      }
      invalidate();
    },
  });
  const status = useMutation({
    mutationFn: (input: { id: string; status: "aktif" | "nonaktif" }) =>
      saSetAreaManagerStatus({ data: { areaManagerId: input.id, status: input.status } }),
    onSuccess: (result) => {
      if (!result.ok && result.code === "LAST_ACTIVE_AREA_MANAGER") {
        setFeedback("Ditolak: ada restoran yang akan kehilangan seluruh AM aktif.");
      }
      invalidate();
    },
  });
  const decide = useMutation({
    mutationFn: (input: { requestId: string; decision: "approved" | "rejected" }) =>
      saDecideAmReset({ data: input }),
    onSuccess: invalidate,
  });
  // Review C13: Super Admin renames an Area Manager (ID immutable).
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const rename = useMutation({
    mutationFn: (input: { targetId: string; fullName: string }) =>
      saRenameStaff({
        data: { targetKind: "area_manager", targetId: input.targetId, fullName: input.fullName },
      }),
    onSuccess: (result) => {
      if (!result.ok) setFeedback(`Ubah nama gagal: ${result.code ?? "error"}`);
      invalidate();
    },
  });

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const restaurantList =
    restaurants.data && restaurants.data.ok
      ? (restaurants.data.restaurants as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          name: String(r.display_name ?? r.id),
        }))
      : [];

  return (
    <div>
      <h1 className="text-xl font-black">Area Manager</h1>
      <p className="mt-1 text-sm text-slate-500">
        Relasi many-to-many. Semua AM aktif yang ditugaskan punya hak penuh dan setara.
      </p>

      {readiness.data?.ok && readiness.data.readiness && (
        <TaCard
          title="Readiness Gate: Cakupan Area Manager"
          description={
            readiness.data.readiness.restaurants_total > 0 &&
            readiness.data.readiness.restaurants_covered ===
              readiness.data.readiness.restaurants_total
              ? "Siap: semua restoran aktif punya minimal satu AM aktif."
              : "Belum siap: tugaskan minimal satu AM aktif untuk restoran berikut."
          }
          className={
            readiness.data.readiness.restaurants_total > 0 &&
            readiness.data.readiness.restaurants_covered ===
              readiness.data.readiness.restaurants_total
              ? "mt-4 border-emerald-200 bg-emerald-50/40"
              : "mt-4 border-red-200 bg-red-50/40"
          }
        >
          <p className="text-sm font-bold">
            {readiness.data.readiness.restaurants_covered}/
            {readiness.data.readiness.restaurants_total} restoran aktif tercakup
          </p>
          {readiness.data.readiness.uncovered.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {readiness.data.readiness.uncovered.map((r) => (
                <li
                  key={r.restaurant_id}
                  className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-600"
                >
                  {r.display_name}
                </li>
              ))}
            </ul>
          )}
        </TaCard>
      )}

      <TaCard title="Buat Area Manager" className="mt-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitCreate}>
          <input
            aria-label="ID Area Manager"
            placeholder="ID Area Manager"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            required
            className="min-h-10 flex-1 rounded-xl border-2 border-slate-200 px-3 text-sm"
          />
          <input
            aria-label="Nama"
            placeholder="Nama"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="min-h-10 flex-1 rounded-xl border-2 border-slate-200 px-3 text-sm"
          />
          <input
            aria-label="Password Awal"
            placeholder="Password awal"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            className="min-h-10 flex-1 rounded-xl border-2 border-slate-200 px-3 text-sm"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}
            Buat
          </button>
        </form>
        {feedback && <p className="mt-2 text-xs font-semibold text-slate-600">{feedback}</p>}
      </TaCard>

      <TaCard title="Permintaan Reset Password Area Manager" className="mt-4">
        {pendingResets.data?.ok && pendingResets.data.requests.length === 0 && (
          <p className="text-sm text-slate-500">Tidak ada permintaan pending.</p>
        )}
        {pendingResets.data?.ok && (
          <ul className="space-y-2">
            {pendingResets.data.requests.map((r) => (
              <li
                key={String(r.request_id)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"
              >
                <span className="font-bold">{String(r.full_name)}</span>
                <span className="text-slate-500">({String(r.staff_id)})</span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                    onClick={() =>
                      decide.mutate({ requestId: String(r.request_id), decision: "approved" })
                    }
                  >
                    Setujui
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600"
                    onClick={() =>
                      decide.mutate({ requestId: String(r.request_id), decision: "rejected" })
                    }
                  >
                    Tolak
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </TaCard>

      <TaCard title="Daftar Area Manager" className="mt-4">
        {ams.isLoading && <Loader2 className="size-4 animate-spin" />}
        {ams.data?.ok && (
          <ul className="space-y-3">
            {ams.data.managers.map((row) => {
              const amId = String(row.id);
              const active = activeRestaurantsOf(row);
              return (
                <li key={amId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs font-bold">{String(row.staff_id)}</span>
                    <span className="font-bold">{String(row.full_name)}</span>
                    <span
                      className={
                        row.status === "aktif"
                          ? "text-xs font-bold text-emerald-600"
                          : "text-xs font-bold text-slate-400"
                      }
                    >
                      {String(row.status)}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700"
                        onClick={() => setRenameTarget({ id: amId, name: String(row.full_name) })}
                      >
                        Ubah Nama
                      </button>
                      {row.status === "aktif" ? (
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-600"
                          onClick={() => status.mutate({ id: amId, status: "nonaktif" })}
                        >
                          Nonaktifkan
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600"
                          onClick={() => status.mutate({ id: amId, status: "aktif" })}
                        >
                          Aktifkan
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {active.map((rid) => {
                      const resto = restaurantList.find((r) => r.id === rid);
                      return (
                        <span
                          key={rid}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold"
                        >
                          {resto?.name ?? rid}
                          <button
                            type="button"
                            aria-label={`Cabut ${resto?.name ?? rid}`}
                            className="text-red-500 hover:text-red-700"
                            onClick={() => revoke.mutate({ amId, restaurantId: rid })}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {/* ponytail: assign-on-change; a11y upgrade path is an
                        explicit "Tugaskan" button with keyboard confirmation. */}
                    <select
                      aria-label="Restoran"
                      name="restaurant"
                      className="h-6 rounded border border-slate-200 text-xs"
                      onChange={(e) => {
                        const select = e.currentTarget;
                        if (select.value) assign.mutate({ amId, restaurantId: select.value });
                        select.value = "";
                      }}
                    >
                      <option value="">+ tugaskan…</option>
                      {restaurantList
                        .filter((r) => !active.includes(r.id))
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </TaCard>

      <EditProfileDialog
        key={renameTarget?.id ?? "none"}
        open={renameTarget !== null}
        currentName={renameTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={async (fullName) => {
          if (!renameTarget) return { ok: false, code: "UNAVAILABLE" };
          return rename.mutateAsync({ targetId: renameTarget.id, fullName });
        }}
      />
    </div>
  );
}
