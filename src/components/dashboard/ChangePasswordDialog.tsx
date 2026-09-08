import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

export function ChangePasswordDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (oldPassword: string, newPassword: string) => Promise<{ ok: boolean; code?: string }>;
}) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const canSubmit = oldPassword.length > 0 && newPassword.length >= 8 && newPassword === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit(oldPassword, newPassword);
      if (!result.ok) {
        setError(
          result.code === "INVALID_CREDENTIALS"
            ? "Password lama salah."
            : result.code === "WEAK_PASSWORD"
              ? "Password baru minimal 8 karakter."
              : "Gagal mengganti password. Coba lagi.",
        );
        return;
      }
      // Success: all sessions (including this one) were revoked server-side.
      onOpenChange(false);
    } catch {
      setError("Gagal mengganti password. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-black">Ganti Password</h2>
        <p className="mt-1 text-xs text-slate-500">
          Setelah berhasil, seluruh sesi dicabut dan Anda harus login ulang.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="password"
            aria-label="Password Lama"
            placeholder="Password Lama"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <input
            type="password"
            aria-label="Password Baru"
            placeholder="Password Baru (min. 8 karakter)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <input
            type="password"
            aria-label="Ketik Ulang Password Baru"
            placeholder="Ketik Ulang Password Baru"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          {confirm.length > 0 && newPassword !== confirm && (
            <p className="text-xs font-semibold text-ta-error">Ketik ulang password tidak cocok.</p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-ta-error/10 px-3 py-2 text-sm font-semibold text-ta-error"
            >
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="min-h-10 flex-1 rounded-xl border border-slate-200 text-sm font-bold"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="min-h-10 flex-1 rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="mr-1 inline size-4 animate-spin" />}
              Simpan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
