import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import {
  amChangeOwnPassword,
  amLogout,
  amScope,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AreaManagerDashboard,
});

const NAV_CARDS = [
  { to: "/am/meja", title: "Status Meja", desc: "Okupansi live per resto." },
  { to: "/am/statistik", title: "Statistik", desc: "Served, peak, okupansi." },
  { to: "/am/leaderboard", title: "Leaderboard", desc: "Peringkat resto per periode." },
  { to: "/am/manager", title: "Manager Resto", desc: "Kelola Manager dalam scope." },
  { to: "/am/password", title: "Password Request", desc: "Setujui/tolak reset password." },
  { to: "/am/audit", title: "Audit Trail", desc: "Jejak pengelolaan Manager." },
] as const;

function AreaManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });

  const changePassword = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      amChangeOwnPassword({ data: input }),
  });

  async function handleLogout() {
    await amLogout();
    removeManagerIdentity(browserManagerStorage());
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

  return (
    <AmLayout
      active="/am"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAV_CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <p className="text-sm font-bold text-slate-900">{c.title}</p>
            <p className="mt-1 text-xs text-slate-500">{c.desc}</p>
          </Link>
        ))}
      </div>

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
      <EditProfileDialog
        key={auth.fullName}
        open={editProfileOpen}
        currentName={auth.fullName}
        onOpenChange={setEditProfileOpen}
        onSubmit={async (fullName) => {
          const result = await updateOwnAmProfile({ data: { fullName } });
          if (result.ok) await queryClient.invalidateQueries();
          return result;
        }}
      />
    </AmLayout>
  );
}
