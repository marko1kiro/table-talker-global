import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { TaCard } from "@/components/dashboard/ui";
import { AmLayout } from "@/components/am/AmLayout";
import { AmRestoTabs } from "@/components/am/AmRestoTabs";
import { loadRestoPick, resolveRestoPick } from "@/lib/am-resto-pick";
import { filterManagersByResto } from "@/lib/am-manager-filter";
import {
  amChangeOwnPassword,
  amCreateManager,
  amLogout,
  amManagers,
  amRenameManager,
  amScope,
  amSetManagerStatus,
  getAmStatus,
  updateOwnAmProfile,
} from "@/lib/area-manager.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/am/manager")({
  loader: () => getAmStatus(),
  head: () => ({
    meta: [{ title: "Manager Resto - Area Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AmManagerPage,
});

function AmManagerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = Route.useLoaderData();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  const scope = useQuery({ queryKey: ["am", "scope"], queryFn: () => amScope() });
  const managers = useQuery({ queryKey: ["am", "managers"], queryFn: () => amManagers() });

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
  const createManager = useMutation({
    mutationFn: (input: {
      staffId: string;
      fullName: string;
      restaurantId: string;
      password: string;
    }) => amCreateManager({ data: input }),
    onSuccess: invalidate,
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
  const active = resolveRestoPick(pick ?? loadRestoPick("manager"), restos);
  const rows =
    managers.data?.ok === true ? filterManagersByResto(managers.data.managers, active) : [];

  return (
    <AmLayout
      active="/am/manager"
      fullName={auth.fullName}
      staffId={auth.staffId}
      onLogout={() => void handleLogout()}
      onChangePassword={() => setChangePasswordOpen(true)}
      onEditProfile={() => setEditProfileOpen(true)}
    >
      <AmRestoTabs menu="manager" restos={restos} value={pick} onChange={setPick} />

      {scope.data?.ok ? (
        <CreateManagerCard
          key={active ?? "none"}
          restaurants={restos}
          initialRestaurantId={active}
          busy={createManager.isPending}
          onCreate={(input) => createManager.mutateAsync(input)}
          lastResult={createManager.data}
        />
      ) : null}

      <TaCard
        title="Manager dalam Scope"
        description="Semua Manager pada restoran dalam scope Anda."
      >
        {managers.isLoading && <Loader2 className="size-4 animate-spin" />}
        {managers.data?.ok && rows.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada Manager.</p>
        )}
        {managers.data?.ok && rows.length > 0 && (
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
                {rows.map((m) => (
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

function CreateManagerCard({
  restaurants,
  initialRestaurantId,
  busy,
  onCreate,
  lastResult,
}: {
  restaurants: { id: string; name: string }[];
  initialRestaurantId?: string | null;
  busy: boolean;
  onCreate: (input: {
    staffId: string;
    fullName: string;
    restaurantId: string;
    password: string;
  }) => Promise<{ ok: boolean; code?: string }>;
  lastResult: { ok: boolean; code?: string } | undefined;
}) {
  const [fullName, setFullName] = useState("");
  const [staffId, setStaffId] = useState("");
  const [restaurantId, setRestaurantId] = useState(
    initialRestaurantId ?? restaurants[0]?.id ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const canSubmit =
    fullName.trim().length >= 1 &&
    /^[a-z0-9._-]{3,32}$/.test(staffId.trim().toLowerCase()) &&
    !!restaurantId &&
    password.length >= 8;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setError("");
    try {
      const result = await onCreate({
        staffId: staffId.trim().toLowerCase(),
        fullName: fullName.trim(),
        restaurantId,
        password,
      });
      if (!result.ok) {
        setError(
          result.code === "STAFF_ID_TAKEN"
            ? "ID sudah dipakai (global, permanen)."
            : result.code === "STAFF_ID_INVALID"
              ? "ID tidak valid."
              : result.code === "NOT_AUTHORIZED"
                ? "Restoran di luar scope Anda."
                : "Gagal membuat Manager.",
        );
        return;
      }
      setPassword("");
    } catch {
      setError("Gagal membuat Manager.");
    }
  }

  if (restaurants.length === 0) return null;
  return (
    <TaCard
      title="Tambah Manager"
      description="ID bersifat permanen dan tidak dapat diubah/dipakai ulang."
    >
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">
          Nama Lengkap
          <input
            aria-label="Nama Manager Baru"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
            required
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal"
          />
        </label>
        <label className="text-xs font-bold text-slate-600">
          ID Staf (3-32, [a-z0-9._-])
          <input
            aria-label="ID Staf Manager Baru"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            pattern="[a-zA-Z0-9._-]{3,32}"
            required
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal"
          />
        </label>
        <label className="text-xs font-bold text-slate-600">
          Restoran
          <select
            aria-label="Restoran Manager Baru"
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal"
          >
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          Password Awal (min. 8)
          <input
            type="password"
            aria-label="Password Awal Manager Baru"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal"
          />
        </label>
        <div className="sm:col-span-2">
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-lg bg-ta-error/10 px-3 py-2 text-sm font-semibold text-ta-error"
            >
              {error}
            </p>
          )}
          {!error && lastResult?.ok ? (
            <p className="mb-2 text-sm font-semibold text-emerald-600">Manager berhasil dibuat.</p>
          ) : null}
          <button
            type="submit"
            disabled={!canSubmit || busy}
            className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="mr-1 inline size-4 animate-spin" />}
            Buat Manager
          </button>
        </div>
      </form>
    </TaCard>
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
