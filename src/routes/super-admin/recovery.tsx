import { useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, Lock, Hash } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Footer } from "@/components/Footer";
import {
  consumeSuperAdminRecovery,
  requestSuperAdminRecovery,
} from "@/lib/super-admin-auth.server";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

export const Route = createFileRoute("/super-admin/recovery")({
  head: () => ({
    meta: [{ title: "Recovery Super Admin - LIME" }, { name: "robots", content: "noindex" }],
  }),
  // Review C11: the emailed recovery link carries staff_id + token as query
  // params; the route validates them and opens the reset stage prefilled.
  validateSearch: (search: Record<string, unknown>): { staff_id?: string; token?: string } => ({
    staff_id: typeof search.staff_id === "string" ? search.staff_id : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: RecoveryPage,
});

/**
 * Inner component takes the validated search as a plain prop so the runtime
 * behaviour (stage selection + prefill) is testable with react-dom/server
 * without a DOM router (review R3-D). RecoveryPage only bridges the router.
 */
export function RecoveryPageInner({ search }: { search: { staff_id?: string; token?: string } }) {
  const [stage, setStage] = useState<"request" | "reset">(
    search.staff_id && search.token ? "reset" : "request",
  );
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [staffId, setStaffId] = useState(search.staff_id ?? "");
  const [token, setToken] = useState(search.token ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestAttemptKeyRef = useRef("");
  const consumeAttemptKeyRef = useRef("");

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    if (!email.includes("@")) return;
    setBusy(true);
    try {
      if (!requestAttemptKeyRef.current) requestAttemptKeyRef.current = crypto.randomUUID();
      await requestSuperAdminRecovery({
        data: { email: email.trim(), attemptKey: requestAttemptKeyRef.current },
      });
      requestAttemptKeyRef.current = "";
      setRequested(true);
    } catch {
      setRequested(true);
    } finally {
      setBusy(false);
    }
  }

  async function consumeReset(event: FormEvent) {
    event.preventDefault();
    if (staffId.trim().length < 3 || token.trim().length < 16 || password.length < 8) return;
    setBusy(true);
    setError("");
    try {
      if (!consumeAttemptKeyRef.current) consumeAttemptKeyRef.current = crypto.randomUUID();
      const result = await consumeSuperAdminRecovery({
        data: {
          staffId: staffId.trim(),
          token: token.trim(),
          password,
          clientKey: getOwnerLoginClientKey(),
          attemptKey: consumeAttemptKeyRef.current,
        },
      });
      consumeAttemptKeyRef.current = "";
      if (!result.ok) {
        setError("Token tidak valid atau sudah digunakan.");
        return;
      }
      setDone(true);
    } catch {
      setError("Reset gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Password Direset
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Password baru berlaku dan seluruh sesi lama telah dicabut. Silakan login ulang.
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

  if (stage === "request") {
    return (
      <AuthLayout>
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
            Recovery Super Admin
          </h1>
          <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
            Masukkan email terverifikasi akun Anda. Tautan reset akan dikirim jika email terdaftar.
          </p>
        </div>
        {requested && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-ta-success/10 px-4 py-3 text-sm font-semibold text-ta-success"
          >
            Jika email terdaftar, token reset telah dikirim (berlaku 30 menit).
          </p>
        )}
        <form className="space-y-4" onSubmit={requestReset}>
          <IconField
            icon={Hash}
            aria-label="Email"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <button
            type="submit"
            disabled={busy || !email.includes("@")}
            className={`${taPrimaryButtonClass} w-full`}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Mengirim..." : "Kirim Token Reset"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <button
            type="button"
            className="font-semibold text-brand-500 hover:underline"
            onClick={() => setStage("reset")}
          >
            Sudah punya token? Reset sekarang
          </button>
        </p>
        <Footer className="mt-6" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Reset Password Super Admin
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Token sekali pakai, berlaku 30 menit.
        </p>
      </div>
      <form className="space-y-4" onSubmit={consumeReset}>
        <IconField
          icon={Hash}
          aria-label="ID Super Admin"
          placeholder="ID Super Admin"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        />
        <IconField
          icon={Lock}
          aria-label="Token Reset"
          placeholder="Token Reset"
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
        <button type="submit" disabled={busy} className={`${taPrimaryButtonClass} w-full`}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Menyimpan..." : "Reset Password"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/" className="font-semibold text-brand-500 hover:underline">
          Kembali
        </Link>
      </p>
      <Footer className="mt-6" />
    </AuthLayout>
  );
}

function RecoveryPage() {
  return <RecoveryPageInner search={Route.useSearch()} />;
}
