import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { TaCard } from "@/components/dashboard/ui";
import { saAdminAudit } from "@/lib/area-manager.server";

export const Route = createFileRoute("/super-admin/audit")({
  head: () => ({ meta: [{ title: "Audit Administratif - Console" }] }),
  component: AuditPage,
});

function AuditPage() {
  const audit = useQuery({ queryKey: ["sa", "audit"], queryFn: () => saAdminAudit() });
  return (
    <div>
      <h1 className="text-xl font-black">Audit Administratif</h1>
      <p className="mt-1 text-sm text-slate-500">
        Catatan append-only seluruh aksi administratif. Tidak memuat password, token, atau secret.
      </p>
      <TaCard title="Log Audit" className="mt-4">
        {audit.isLoading && <Loader2 className="size-4 animate-spin" />}
        {audit.data?.ok === false && (
          <p role="alert" className="text-sm text-red-600">
            Audit tidak dapat dimuat.
          </p>
        )}
        {audit.data?.ok && audit.data.entries.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada entri.</p>
        )}
        {audit.data?.ok && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Waktu</th>
                  <th className="px-3 py-2">Aktor</th>
                  <th className="px-3 py-2">Aksi</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Hasil</th>
                  <th className="px-3 py-2">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.entries.map((e) => (
                  <tr key={String(e.id)} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {String(e.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {String(e.actor_kind)}
                      {e.actor_label ? ` (${String(e.actor_label)})` : ""}
                    </td>
                    <td className="px-3 py-2 font-bold">{String(e.action)}</td>
                    <td className="px-3 py-2">
                      {String(e.target_kind ?? "")}
                      {e.target_id ? ` · ${String(e.target_id).slice(0, 8)}…` : ""}
                      {e.restaurant_id ? ` @ ${String(e.restaurant_id).slice(0, 8)}…` : ""}
                    </td>
                    <td
                      className={
                        e.result === "ok"
                          ? "px-3 py-2 font-bold text-emerald-600"
                          : "px-3 py-2 font-bold text-red-600"
                      }
                    >
                      {String(e.result)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {e.reason ? String(e.reason) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TaCard>
    </div>
  );
}
