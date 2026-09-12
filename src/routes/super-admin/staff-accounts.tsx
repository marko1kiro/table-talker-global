import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { TaCard } from "@/components/dashboard/ui";
import {
  cancelSuperAdminInvite,
  getSuperAdmins,
  inviteSuperAdmin,
  resendSuperAdminInvite,
  saRenameStaff,
  setSuperAdminStatus,
} from "@/lib/super-admin-auth.server";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";

export const Route = createFileRoute("/super-admin/staff-accounts")({
  head: () => ({ meta: [{ title: "Super Admin - Console" }] }),
  component: StaffAccountsPage,
});

function StaffAccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["sa", "accounts"], queryFn: () => getSuperAdmins() });
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sa", "accounts"] });

  const invite = useMutation({
    mutationFn: () =>
      inviteSuperAdmin({
        data: { staffId: staffId.trim(), fullName: fullName.trim(), email: email.trim() },
      }),
    onSuccess: (result) => {
      setFeedback(
        result.ok
          ? "Undangan terkirim (berlaku 24 jam)."
          : result.code === "EMAIL_UNAVAILABLE"
            ? "Layanan email belum dikonfigurasi (RESEND_API_KEY/STAFF_EMAIL_FROM). Undangan tidak dibuat."
            : `Undangan gagal: ${result.code ?? "error"}`,
      );
      if (result.ok) {
        setStaffId("");
        setFullName("");
        setEmail("");
        invalidate();
      }
    },
  });
  const resend = useMutation({
    mutationFn: (id: string) => resendSuperAdminInvite({ data: { superAdminId: id } }),
    onSuccess: () => setFeedback("Token lama dibatalkan; token baru dikirim."),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSuperAdminInvite({ data: { superAdminId: id } }),
    onSuccess: invalidate,
  });
  const status = useMutation({
    mutationFn: (input: { id: string; status: "aktif" | "nonaktif" }) =>
      setSuperAdminStatus({ data: { superAdminId: input.id, status: input.status } }),
    onSuccess: (result) => {
      if (!result.ok && result.code === "LAST_ACTIVE_SUPER_ADMIN") {
        setFeedback("Ditolak: minimal satu Super Admin aktif harus tersisa.");
        return;
      }
      invalidate();
    },
  });
  // Review C13: Super Admin renames other staff profiles (ID immutable).
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const rename = useMutation({
    mutationFn: (input: { targetId: string; fullName: string }) =>
      saRenameStaff({
        data: { targetKind: "super_admin", targetId: input.targetId, fullName: input.fullName },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setFeedback("Nama diperbarui.");
        invalidate();
      } else {
        setFeedback(`Ubah nama gagal: ${result.code ?? "error"}`);
      }
    },
  });

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    invite.mutate();
  }

  return (
    <div>
      <h1 className="text-xl font-black">Akun Super Admin</h1>
      <p className="mt-1 text-sm text-slate-500">
        ID permanen, tidak dapat diubah atau dipakai ulang. Tidak ada registrasi publik.
      </p>

      <TaCard title="Undang Super Admin Baru" className="mt-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitInvite}>
          <input
            aria-label="ID Super Admin"
            placeholder="ID Super Admin"
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
          <input
            aria-label="Email"
            placeholder="Email (recovery)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="min-h-10 flex-1 rounded-xl border-2 border-slate-200 px-3 text-sm"
          />
          <button
            type="submit"
            disabled={invite.isPending}
            className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {invite.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}
            Kirim Undangan
          </button>
        </form>
        {feedback && <p className="mt-2 text-xs font-semibold text-slate-600">{feedback}</p>}
      </TaCard>

      <TaCard title="Daftar Akun" className="mt-4">
        {accounts.isLoading && <Loader2 className="size-4 animate-spin" />}
        {accounts.data?.ok && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.accounts.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{a.staffId}</td>
                    <td className="px-3 py-2 font-bold">{a.fullName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          a.status === "aktif"
                            ? "font-bold text-emerald-600"
                            : "font-bold text-slate-400"
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {a.status === "pending_activation" && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700"
                            onClick={() => resend.mutate(a.id)}
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600"
                            onClick={() => cancel.mutate(a.id)}
                          >
                            Batalkan
                          </button>
                        </span>
                      )}
                      {a.status === "aktif" && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                            onClick={() => setRenameTarget({ id: a.id, name: a.fullName })}
                          >
                            Ubah Nama
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600"
                            onClick={() => status.mutate({ id: a.id, status: "nonaktif" })}
                          >
                            Nonaktifkan
                          </button>
                        </span>
                      )}
                      {a.status === "nonaktif" && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                            onClick={() => setRenameTarget({ id: a.id, name: a.fullName })}
                          >
                            Ubah Nama
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600"
                            onClick={() => status.mutate({ id: a.id, status: "aktif" })}
                          >
                            Aktifkan
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TaCard>

      <EditProfileDialog
        key={renameTarget?.id ?? "none"}
        open={renameTarget !== null}
        currentName={renameTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={async (fullName) => {
          if (!renameTarget) return { ok: false, code: "UNAVAILABLE" };
          return rename.mutateAsync({ targetId: renameTarget.id, fullName });
        }}
      />
    </div>
  );
}
