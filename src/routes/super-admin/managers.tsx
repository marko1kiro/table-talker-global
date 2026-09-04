import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { disableManager, listManagers } from "@/lib/admin-managers.server";

export const Route = createFileRoute("/super-admin/managers")({
  head: () => ({ meta: [{ title: "Manager - Owner Console" }] }),
  component: ManagersPage,
});

function ManagersPage() {
  const queryClient = useQueryClient();
  const managers = useQuery({ queryKey: ["owner", "managers"], queryFn: () => listManagers() });
  const disable = useMutation({
    mutationFn: (id: string) => disableManager({ data: { managerId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["owner", "managers"] }),
  });

  return (
    <div>
      <h1 className="text-xl font-black">Manager</h1>
      <p className="mt-1 text-sm text-slate-500">Audit akun manager per restoran.</p>
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
                  <td className="px-3 py-2 font-bold">{m.fullName}</td>
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
                    {m.status === "aktif" && (
                      <button
                        type="button"
                        onClick={() => disable.mutate(m.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      >
                        Nonaktifkan
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
