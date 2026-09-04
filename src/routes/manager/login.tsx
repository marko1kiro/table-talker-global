import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    <main className="flex min-h-[100svh] items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <img src="/lime-logo.webp" alt="LIME" className="mx-auto h-14 w-auto" />
        <h1 className="mt-4 text-center text-2xl font-black text-slate-900">Login Manager</h1>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-bold text-slate-700" htmlFor="mgr-id">
            ID Manager
          </label>
          <Input
            id="mgr-id"
            value={idManager}
            onChange={(e) => setIdManager(e.target.value)}
            required
            autoFocus
            className="h-12 rounded-xl"
          />
          <label className="block text-sm font-bold text-slate-700" htmlFor="mgr-pw">
            Password
          </label>
          <Input
            id="mgr-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-12 rounded-xl"
          />
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold uppercase text-white disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memeriksa..." : "Login"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <Link to="/manager/register" className="font-bold text-cyan-700 underline">
            KLIK DISINI untuk membuat ID MANAGER BARU
          </Link>
        </p>
      </div>
    </main>
  );
}
