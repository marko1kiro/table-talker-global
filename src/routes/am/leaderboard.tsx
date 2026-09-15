import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import {
  amChangeOwnPassword,
  amLogout,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/leaderboard")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Leaderboard - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmLeaderboardPage,
});

function AmLeaderboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

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
      active="/am/leaderboard"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <TaCard title="Segera hadir di 7.1b" description="Leaderboard">
        <p className="text-sm text-slate-500">
          Bandingkan peringkat resto dalam scope Anda per periode.
        </p>
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
