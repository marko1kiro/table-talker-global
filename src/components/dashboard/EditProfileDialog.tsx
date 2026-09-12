import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

export function EditProfileDialog({
  open,
  currentName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  currentName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (fullName: string) => Promise<{ ok: boolean; code?: string }>;
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 80;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit(trimmed);
      if (!result.ok) {
        setError(result.code === "NOT_AUTHORIZED" ? "Tidak diizinkan." : "Gagal menyimpan nama.");
        return;
      }
      onOpenChange(false);
    } catch {
      setError("Gagal menyimpan nama. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-black">Edit Nama Profil</h2>
        <p className="mt-1 text-xs text-slate-500">
          ID staf bersifat permanen dan tidak dapat diubah.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="text"
            aria-label="Nama Lengkap"
            placeholder="Nama Lengkap"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
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
