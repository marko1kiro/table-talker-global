import { useState, type FormEvent } from "react";
import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, Lock, Hash } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Footer } from "@/components/Footer";
import { acceptSuperAdminInvite } from "@/lib/super-admin-auth.server";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

type AcceptSearch = { staff_id?: string; token?: string };

export const Route = createFileRoute("/super-admin/accept")({
  validateSearch: (search: Record<string, unknown>): AcceptSearch => ({
    staff_id: typeof search.staff_id === "string" ? search.staff_id : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({
    meta: [{ title: "Aktivasi Super Admin - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const search = useSearch({ from: "/super-admin/accept" });
  const [staffId, setStaffId] = useState(search.staff_id ?? "");
  const [token, setToken] = useState(search.token ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    staffId.trim().length >= 3 &&
    token.trim().length >= 16 &&
    password.length >= 8 &&
    password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const result = await acceptSuperAdminInvite({
        data: {
          staffId: staffId.trim(),
          token: token.trim(),
          password,
          clientKey: getOwnerLoginClientKey(),
        },
      });
      if (!result.ok) {
        setError(
          result.code === "INVITATION_EXPIRED"
            ? "Undangan kedaluwarsa. Minta Super Admin mengirim undangan baru."
            : "Token undangan tidak valid.",
        );
        return;
      }
      setDone(true);
    } catch {
      setError("Aktivasi gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Akun Super Admin Aktif
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Email terverifikasi dan password tersimpan. Silakan login dengan ID Super Admin Anda.
        </p>
        <p className="mt-6 text-center text-sm">
          <Link to="/" className="font-semibold text-brand-500 hover:underline">
            Ke Halaman Login Super Admin
          </Link>
        </p>
        <Footer className="mt-6" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Aktivasi Akun Super Admin
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Tetapkan password Anda. Token undangan berlaku 24 jam sejak dikirim.
        </p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <IconField
          icon={Hash}
          aria-label="ID Super Admin"
          placeholder="ID Super Admin"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          autoComplete="username"
          required
        />
        <IconField
          icon={Lock}
          aria-label="Token Undangan"
          placeholder="Token Undangan"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <IconField
          icon={Lock}
          aria-label="Password Baru"
          placeholder="Password Baru"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          trailing={
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className="text-ta-gray-400 transition hover:text-ta-gray-600"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          }
        />
        <IconField
          icon={Lock}
          aria-label="Ketik Ulang Password"
          placeholder="Ketik Ulang Password"
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {password.length > 0 && password.length < 8 && (
          <p className="text-xs font-semibold text-ta-error">Password minimal 8 karakter.</p>
        )}
        {confirm.length > 0 && password !== confirm && (
          <p className="text-xs font-semibold text-ta-error">Ketik ulang password tidak cocok.</p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className={`${taPrimaryButtonClass} w-full`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Mengaktifkan..." : "Aktifkan Akun"}
        </button>
      </form>
      <Footer className="mt-6" />
    </AuthLayout>
  );
}
