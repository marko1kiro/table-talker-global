import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import { AmRestoTabs } from "@/components/am/AmRestoTabs";
import { loadRestoPick, resolveRestoPick } from "@/lib/am-resto-pick";
import {
  amAudit,
  amChangeOwnPassword,
  amLogout,
  amScope,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/audit")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Audit Trail - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmAuditPage,
});

const PAGE_SIZE = 20;

function AmAuditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });
  const audit = useQuery({ queryKey: ["am", "audit"], queryFn: () => amAudit() });

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

  const restos =
    scope.data?.ok === true
      ? scope.data.restaurants.map((r) => ({
          id: String(r.restaurant_id),
          name: String(r.display_name),
        }))
      : [];
  const active = resolveRestoPick(pick ?? loadRestoPick("audit"), restos);

  useEffect(() => {
    setPage(0);
  }, [active]);

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

  const entries =
    audit.data?.ok === true
      ? audit.data.entries.filter((e) => !active || String(e.restaurant_id) === active)
      : [];
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <AmLayout
      active="/am/audit"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <AmRestoTabs menu="audit" restos={restos} value={pick} onChange={setPick} />

      <TaCard title="Audit Pengelolaan Manager" description="Hanya restoran dalam scope Anda.">
        {audit.isLoading && <Loader2 className="size-4 animate-spin" />}
        {audit.data?.ok && entries.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada aktivitas pada resto ini.</p>
        )}
        {audit.data?.ok && entries.length > 0 && (
          <>
            <ul className="space-y-1 text-xs text-slate-600">
              {visible.map((e) => (
                <li key={String(e.id)} className="border-b border-slate-100 py-1">
                  <span className="font-bold">{String(e.action)}</span>{" "}
                  <span className="text-slate-400">{String(e.created_at)}</span>{" "}
                  <span
                    className={e.result === "ok" ? "text-emerald-600" : "text-red-600 font-bold"}
                  >
                    {String(e.result)}
                  </span>
                  {e.reason ? <span className="text-slate-400"> · {String(e.reason)}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <button
                type="button"
                disabled={safePage === 0}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-600 disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Sebelumnya
              </button>
              <span className="text-slate-500">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-600 disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Berikutnya
              </button>
            </div>
          </>
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
