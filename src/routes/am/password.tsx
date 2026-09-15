import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import { AmRestoTabs } from "@/components/am/AmRestoTabs";
import { loadRestoPick, resolveRestoPick } from "@/lib/am-resto-pick";
import { selectResetDecisions } from "@/lib/am-password-history";
import {
  amAudit,
  amChangeOwnPassword,
  amDecideManagerReset,
  amLogout,
  amPendingResets,
  amScope,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/password")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Password Request - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmPasswordPage,
});

function AmPasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });
  const pending = useQuery({ queryKey: ["am", "pending"], queryFn: () => amPendingResets() });
  const audit = useQuery({ queryKey: ["am", "audit"], queryFn: () => amAudit() });

  const decide = useMutation({
    mutationFn: (input: { requestId: string; decision: "approved" | "rejected" }) =>
      amDecideManagerReset({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["am"] });
    },
  });
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

  const restos =
    scope.data?.ok === true
      ? scope.data.restaurants.map((r) => ({
          id: String(r.restaurant_id),
          name: String(r.display_name),
        }))
      : [];
  const active = resolveRestoPick(pick ?? loadRestoPick("password"), restos);
  const requests =
    pending.data?.ok === true
      ? pending.data.requests.filter((r) => !active || String(r.restaurant_id) === active)
      : [];
  const decisions =
    audit.data?.ok === true ? selectResetDecisions(audit.data.entries, active) : [];

  return (
    <AmLayout
      active="/am/password"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <AmRestoTabs menu="password" restos={restos} value={pick} onChange={setPick} />

      <TaCard
        title="Permintaan Reset Password Manager"
        description="Keputusan pertama bersifat final."
      >
        {pending.isLoading && <Loader2 className="size-4 animate-spin" />}
        {pending.data?.ok && requests.length === 0 && (
          <p className="text-sm text-slate-500">Tidak ada permintaan pending.</p>
        )}
        {pending.data?.ok && requests.length > 0 && (
          <ul className="space-y-2">
            {requests.map((r) => (
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
                    disabled={decide.isPending}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    onClick={() =>
                      decide.mutate({ requestId: String(r.request_id), decision: "approved" })
                    }
                  >
                    Setujui
                  </button>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
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

      <TaCard title="Riwayat Keputusan" description="Keputusan reset pada resto yang dipilih.">
        {audit.isLoading && <Loader2 className="size-4 animate-spin" />}
        {audit.data?.ok && decisions.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada keputusan.</p>
        )}
        {audit.data?.ok && decisions.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-600">
            {decisions.slice(0, 50).map((e) => (
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
