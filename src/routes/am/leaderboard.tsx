import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard, taControlClass } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import { wibDateKey } from "@/lib/crew-history-scope";
import { rankRestos } from "@/lib/am-leaderboard";
import {
  amChangeOwnPassword,
  amLogout,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { amLeaderboard } from "@/lib/am-tables.server";
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

type Preset = "today" | "yesterday" | "7d" | "30d" | "custom";

function shiftWib(days: number): string {
  return wibDateKey(new Date(Date.now() + days * 86_400_000));
}

function presetRange(
  preset: Preset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const today = wibDateKey();
  if (preset === "yesterday") {
    const y = shiftWib(-1);
    return { from: y, to: y };
  }
  if (preset === "7d") return { from: shiftWib(-6), to: today };
  if (preset === "30d") return { from: shiftWib(-29), to: today };
  if (preset === "custom") return { from: customFrom || today, to: customTo || today };
  return { from: today, to: today };
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Hari ini" },
  { id: "yesterday", label: "Kemarin" },
  { id: "7d", label: "7 hari" },
  { id: "30d", label: "30 hari" },
  { id: "custom", label: "Custom" },
];

function AmLeaderboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(() => wibDateKey());
  const [customTo, setCustomTo] = useState(() => wibDateKey());

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

  const { from, to } = presetRange(preset, customFrom, customTo);

  const board = useQuery({
    queryKey: ["am", "leaderboard", from, to],
    queryFn: () => amLeaderboard({ data: { from, to } }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to),
    placeholderData: keepPreviousData,
  });

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

  const ranked =
    board.data?.ok === true
      ? rankRestos(
          board.data.rows.map((r) => ({
            id: String(r.restaurantId),
            name: String(r.displayName),
            guests: Number(r.guests),
          })),
        )
      : [];

  return (
    <AmLayout
      active="/am/leaderboard"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <TaCard
        title="Leaderboard Resto"
        description={`Periode ${from} s/d ${to} (WIB), lintas resto.`}
      >
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
              className={
                preset === p.id
                  ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-500"
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="mt-3 grid max-w-md grid-cols-2 gap-2">
            <label className="block text-sm font-medium text-slate-700">
              Dari
              <input
                type="date"
                value={customFrom}
                max={wibDateKey()}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={taControlClass}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Sampai
              <input
                type="date"
                value={customTo}
                max={wibDateKey()}
                onChange={(e) => setCustomTo(e.target.value)}
                className={taControlClass}
              />
            </label>
          </div>
        )}

        {board.isLoading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Memuat leaderboard...
          </p>
        ) : board.data && !board.data.ok ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            Gagal memuat leaderboard.
          </p>
        ) : ranked.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Belum ada data tamu pada periode ini.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-slate-400">
                  <th className="border border-black/10 px-3 py-1 text-center">Peringkat</th>
                  <th className="border border-black/10 px-3 py-1 text-left">Resto</th>
                  <th className="border border-black/10 px-3 py-1 text-center">Tamu</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.id} className="text-slate-800">
                    <td className="border border-black/10 px-3 py-2 text-center font-bold">
                      {i + 1}
                    </td>
                    <td className="border border-black/10 px-3 py-2">{r.name}</td>
                    <td className="border border-black/10 px-3 py-2 text-center font-bold">
                      {r.guests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
