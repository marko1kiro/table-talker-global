import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  disableManager,
  enableManager,
  listManagers,
  saCreateManager,
  saRenameManager,
} from "@/lib/admin-managers.server";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import { TaCard } from "@/components/dashboard/ui";

export const Route = createFileRoute("/super-admin/managers")({
  head: () => ({ meta: [{ title: "Manager - Super Admin Console" }] }),
  component: ManagersPage,
});

function ManagersPage() {
  const queryClient = useQueryClient();
  const managers = useQuery({ queryKey: ["owner", "managers"], queryFn: () => listManagers() });
  const restaurants = useQuery({
    queryKey: ["sa", "restaurants"],
    queryFn: () => listOwnerRestaurants(),
  });
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["owner", "managers"] });

  const create = useMutation({
    mutationFn: () =>
      saCreateManager({
        data: {
          staffId: staffId.trim(),
          fullName: fullName.trim(),
          restaurantId,
          password,
        },
      }),
    onSuccess: (result) => {
      setFeedback(
        result.ok
          ? "Manager dibuat."
          : result.code === "STAFF_ID_TAKEN"
            ? "ID sudah dipakai (namespace global, termasuk riwayat akun nonaktif)."
            : result.code === "STAFF_ID_INVALID"
              ? "ID tidak valid: 3-32 karakter, huruf kecil/angka/._-."
              : result.code === "WEAK_PASSWORD"
                ? "Password minimal 8 karakter."
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
  const disable = useMutation({
    mutationFn: (id: string) => disableManager({ data: { managerId: id } }),
    onSuccess: invalidate,
  });
  const enable = useMutation({
    mutationFn: (id: string) => enableManager({ data: { managerId: id } }),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; fullName: string }) =>
      saRenameManager({ data: { managerId: input.id, fullName: input.fullName } }),
    onSuccess: () => {
      setEditingId(null);
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
      <h1 className="text-xl font-black">Manager</h1>
      <p className="mt-1 text-sm text-slate-500">
        Akun Manager terikat tepat satu restoran. Tidak ada mutasi antarrestoran: nonaktifkan di
        asal, buat akun baru di tujuan.
      </p>

      <TaCard title="Buat Manager" className="mt-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitCreate}>
          <input
            aria-label="ID Manager"
            placeholder="ID Manager"
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
          <select
            aria-label="Restoran"
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            required
            className="min-h-10 flex-1 rounded-xl border-2 border-slate-200 px-2 text-sm"
          >
            <option value="">Pilih restoran…</option>
            {restaurantList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
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
            Buat
          </button>
        </form>
        {feedback && <p className="mt-2 text-xs font-semibold text-slate-600">{feedback}</p>}
      </TaCard>

      {managers.isLoading && <p className="mt-4 text-sm">Memuat...</p>}
      {managers.data && managers.data.ok && managers.data.managers.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">Belum ada manager terdaftar.</p>
      )}
      {managers.data && managers.data.ok && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nama</th>
                <th className="px-3 py-2">ID Manager</th>
                <th className="px-3 py-2">Resto</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {managers.data.managers.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold">
                    {editingId === m.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e: FormEvent) => {
                          e.preventDefault();
                          rename.mutate({ id: m.id, fullName: editName.trim() });
                        }}
                      >
                        <input
                          aria-label="Nama Baru"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="min-h-8 w-32 rounded border border-slate-200 px-2 text-sm"
                        />
                        <button type="submit" className="text-xs font-bold text-brand-600">
                          Simpan
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditName(m.fullName);
                        }}
                      >
                        {m.fullName}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">{m.idManager}</td>
                  <td className="px-3 py-2">{m.restaurantCode}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        m.status === "aktif"
                          ? "text-emerald-600 font-bold"
                          : "text-slate-400 font-bold"
                      }
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {m.status === "aktif" ? (
                      <button
                        type="button"
                        onClick={() => disable.mutate(m.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      >
                        Nonaktifkan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => enable.mutate(m.id)}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-100"
                      >
                        Aktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
