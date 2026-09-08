import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { Footer } from "@/components/Footer";
import { TaCard } from "@/components/dashboard/ui";
import {
  amAudit,
  amChangeOwnPassword,
  amDecideManagerReset,
  amLogout,
  amManagers,
  amPendingResets,
  amRenameManager,
  amScope,
  amSetManagerStatus,
  getAmStatus,
} from "@/lib/area-manager.server";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";

export const Route = createFileRoute("/am/")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AreaManagerDashboard,
});

function AreaManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });
  const managers = useQuery({ queryKey: ["am", "managers"], queryFn: () => amManagers() });
  const pending = useQuery({ queryKey: ["am", "pending"], queryFn: () => amPendingResets() });
  const audit = useQuery({ queryKey: ["am", "audit"], queryFn: () => amAudit() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["am"] });
  };

  const setStatus = useMutation({
    mutationFn: (input: { managerId: string; status: "aktif" | "nonaktif" }) =>
      amSetManagerStatus({ data: input }),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: (input: { managerId: string; fullName: string }) =>
      amRenameManager({ data: input }),
    onSuccess: invalidate,
  });
  const decide = useMutation({
    mutationFn: (input: { requestId: string; decision: "approved" | "rejected" }) =>
      amDecideManagerReset({ data: input }),
    onSuccess: invalidate,
  });
  const changePassword = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      amChangeOwnPassword({ data: input }),
  });

  async function handleLogout() {
    await amLogout();
    queryClient.removeQueries({ predicate: (query) => isOwnerQueryKey(query.queryKey) });
    await navigate({ to: "/manager/login" });
  }

  if (!auth.authenticated) {
    return (
      <TaCard title="Sesi Berakhir">
        <p className="text-sm text-slate-500">Silakan login ulang sebagai Area Manager.</p>
        <button
          type="button"
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
          onClick={() => void navigate({ to: "/manager/login" })}
        >
          Ke Login Staf
        </button>
      </TaCard>
    );
  }

  const navItems: AppShellNavItem[] = [
    { id: "/am", label: "Dashboard", icon: ShieldCheck, active: true, onSelect: () => undefined },
  ];

  return (
    <AppShell
      brand={
        <div className="flex items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0" />
          <span className="flex items-center gap-1 text-sm font-bold text-ta-gray-900">
            <ShieldCheck className="size-4 text-brand-500" /> Area Manager
          </span>
        </div>
      }
      navItems={navItems}
      headerTitle="Area Manager"
      headerRight={
        <DashboardHeaderRight
          roleLabel="AREA MANAGER"
          profile={{ name: "Area Manager", canChangePassword: true }}
          onLogout={() => void handleLogout()}
          onChangePassword={() => setChangePasswordOpen(true)}
        />
      }
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      <TaCard title="Restoran dalam Scope" description="Assignment aktif Area Manager ini.">
        {scope.isLoading && <Loader2 className="size-4 animate-spin" />}
        {scope.data?.ok && scope.data.restaurants.length === 0 && (
          <p className="text-sm text-slate-500">
            Belum ada restoran dalam scope Anda. Hubungi Super Admin.
          </p>
        )}
        {scope.data?.ok && (
          <ul className="flex flex-wrap gap-2">
            {scope.data.restaurants.map((r) => (
              <li
                key={String(r.restaurant_id)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold"
              >
                {String(r.display_name)}
              </li>
            ))}
          </ul>
        )}
      </TaCard>

      <TaCard
        title="Permintaan Reset Password Manager"
        description="Keputusan pertama bersifat final."
      >
        {pending.isLoading && <Loader2 className="size-4 animate-spin" />}
        {pending.data?.ok && pending.data.requests.length === 0 && (
          <p className="text-sm text-slate-500">Tidak ada permintaan pending.</p>
        )}
        {pending.data?.ok && (
          <ul className="space-y-2">
            {pending.data.requests.map((r) => (
              <li
                key={String(r.request_id)}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"
              >
                <span className="font-bold">{String(r.full_name)}</span>
                <span className="text-slate-500">
                  ({String(r.staff_id)} · {String(r.restaurant_name)})
                </span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                    onClick={() =>
                      decide.mutate({ requestId: String(r.request_id), decision: "approved" })
                    }
                  >
                    Setujui
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
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

      <TaCard
        title="Manager dalam Scope"
        description="Semua Manager pada restoran dalam scope Anda."
      >
        {managers.isLoading && <Loader2 className="size-4 animate-spin" />}
        {managers.data?.ok && managers.data.managers.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada Manager.</p>
        )}
        {managers.data?.ok && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Resto</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {managers.data.managers.map((m) => (
                  <ManagerRow
                    key={String(m.manager_id)}
                    row={m}
                    onStatus={(status) =>
                      setStatus.mutate({ managerId: String(m.manager_id), status })
                    }
                    onRename={(fullName) =>
                      rename.mutate({ managerId: String(m.manager_id), fullName })
                    }
                    busy={setStatus.isPending || rename.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TaCard>

      <TaCard title="Audit Pengelolaan Manager" description="Hanya restoran dalam scope Anda.">
        {audit.isLoading && <Loader2 className="size-4 animate-spin" />}
        {audit.data?.ok && (
          <ul className="space-y-1 text-xs text-slate-600">
            {audit.data.entries.slice(0, 50).map((e) => (
              <li key={String(e.id)} className="border-b border-slate-100 py-1">
                <span className="font-bold">{String(e.action)}</span>{" "}
                <span className="text-slate-400">{String(e.created_at)}</span>{" "}
                <span className={e.result === "ok" ? "text-emerald-600" : "text-red-600 font-bold"}>
                  {String(e.result)}
                </span>
                {e.reason ? <span className="text-slate-400"> · {String(e.reason)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </TaCard>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        onSubmit={async (oldPassword, newPassword) => {
          const result = await changePassword.mutateAsync({ oldPassword, newPassword });
          if (result.ok) {
            await handleLogout();
          }
          return result;
        }}
      />
    </AppShell>
  );
}

function ManagerRow({
  row,
  onStatus,
  onRename,
  busy,
}: {
  row: Record<string, unknown>;
  onStatus: (status: "aktif" | "nonaktif") => void;
  onRename: (fullName: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(String(row.full_name ?? ""));
  const status = String(row.status);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-bold">
        {editing ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onRename(name.trim());
              setEditing(false);
            }}
            className="flex gap-1"
          >
            <input
              aria-label="Nama Manager"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
            onClick={() => setEditing(true)}
          >
            {String(row.full_name)}
          </button>
        )}
      </td>
      <td className="px-3 py-2">{String(row.staff_id)}</td>
      <td className="px-3 py-2">{String(row.restaurant_name)}</td>
      <td className="px-3 py-2">
        <span
          className={status === "aktif" ? "font-bold text-emerald-600" : "font-bold text-slate-400"}
        >
          {status}
        </span>
      </td>
      <td className="px-3 py-2">
        {status === "aktif" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus("nonaktif")}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
          >
            Nonaktifkan
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus("aktif")}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-100"
          >
            Aktifkan
          </button>
        )}
      </td>
    </tr>
  );
}
