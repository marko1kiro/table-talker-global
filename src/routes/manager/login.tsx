import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Hash, Loader2, Lock } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { loginManager } from "@/lib/manager-auth.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { browserManagerStorage, writeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/manager/login")({
  head: () => ({
    meta: [{ title: "Login Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerLoginPage,
});

function ManagerLoginPage() {
  const navigate = useNavigate();
  const [idManager, setIdManager] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = idManager.trim().length > 0 && password.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const accessToken = await ensureAnonAccessToken(getSupabaseBrowserClient());
      if (!accessToken) {
        setError("Gagal memulai sesi. Coba lagi.");
        return;
      }
      const result = await loginManager({ data: { idManager, password } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      writeManagerIdentity(browserManagerStorage(), {
        idManager: result.idManager,
        fullName: result.fullName,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.restaurantDisplayName,
        restaurantCode: result.restaurantCode,
        managerToken: result.managerToken,
        accessToken,
      });
      void navigate({ to: "/manager" });
    } catch {
      setError("Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Login Manager
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Masukkan ID Manager dan password untuk masuk ke dashboard.
        </p>
      </div>
      <form className="space-y-5" onSubmit={submit}>
        <IconField
          icon={Hash}
          aria-label="ID Manager"
          placeholder="ID Manager"
          value={idManager}
          onChange={(e) => setIdManager(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <IconField
          icon={Lock}
          aria-label="Password"
          placeholder="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
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
          {busy ? "Memeriksa..." : "Login"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ta-gray-500 dark:text-ta-gray-400">
        <Link to="/manager/register" className="font-semibold text-brand-500 hover:underline">
          KLIK DISINI untuk membuat ID MANAGER BARU
        </Link>
      </p>
    </AuthLayout>
  );
}
