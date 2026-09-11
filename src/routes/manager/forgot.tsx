import { useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Hash, Loader2, Lock } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Footer } from "@/components/Footer";
import { submitManagerResetRequest } from "@/lib/staff-password-reset.server";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

export const Route = createFileRoute("/manager/forgot")({
  head: () => ({
    meta: [{ title: "Lupa Password Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerForgotPage,
});

function ManagerForgotPage() {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const attemptKeyRef = useRef("");

  const canSubmit =
    staffId.trim().length > 0 && password.length >= 8 && confirm.length > 0 && password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (!attemptKeyRef.current) attemptKeyRef.current = crypto.randomUUID();
      await submitManagerResetRequest({
        data: {
          staffId: staffId.trim(),
          newPassword: password,
          clientKey: getOwnerLoginClientKey(),
          attemptKey: attemptKeyRef.current,
        },
      });
      attemptKeyRef.current = "";
      // Respons selalu generik: tidak mengungkap apakah ID ada.
      setNotice(true);
    } catch {
      setNotice(true);
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Permintaan Diproses
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Jika ID terdaftar, permintaan reset password telah dikirim ke Area Manager restoran Anda
          untuk persetujuan. Password lama tetap berlaku sampai disetujui.
        </p>
        <p className="mt-6 text-center text-sm">
          <Link to="/manager/login" className="font-semibold text-brand-500 hover:underline">
            Kembali ke Login
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
          Lupa Password Manager
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Masukkan ID Manager dan password baru. Area Manager restoran Anda akan menyetujui
          permintaan ini.
        </p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <IconField
          icon={Hash}
          aria-label="ID Manager"
          placeholder="ID Manager"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          autoComplete="username"
          autoFocus
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
          aria-label="Ketik Ulang Password Baru"
          placeholder="Ketik Ulang Password Baru"
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
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className={`${taPrimaryButtonClass} w-full`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Mengirim..." : "Ajukan Reset"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/manager/login" className="font-semibold text-brand-500 hover:underline">
          Kembali ke Login
        </Link>
      </p>
      <Footer className="mt-6" />
    </AuthLayout>
  );
}
