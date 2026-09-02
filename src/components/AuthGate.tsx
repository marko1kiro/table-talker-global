import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Loader2 } from "lucide-react";
import { Footer } from "@/components/Footer";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

interface AuthGateProps {
  onSuccess: () => Promise<void> | void;
  title?: string;
  instruction?: string;
  submitLabel?: string;
  loginAction: (input: {
    data: { password: string; clientKey: string };
  }) => Promise<{ ok: boolean; message?: string }>;
}

export function AuthGate({
  onSuccess,
  title = "SIMPLE, SMART, SMOOTH !",
  instruction = "Masukkan kode resto dulu ya!",
  submitLabel = "Gassss!",
  loginAction,
}: AuthGateProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await loginAction({ data: { password, clientKey: getOwnerLoginClientKey() } });
      if (!result.ok) {
        setError(result.message || "Login gagal.");
        return;
      }
      await onSuccess();
    } catch {
      setError("Login gagal. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const ownerLogin = title === "Login Owner";

  return (
    <main className="flex min-h-[100svh] flex-col bg-slate-950 text-white">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(251,191,36,0.28),transparent_28%),radial-gradient(circle_at_80%_75%,rgba(56,189,248,0.16),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:40px_40px]" />

        <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-sm lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden flex-col justify-between p-10 lg:flex">
            <div className="flex items-center gap-3">
              <img src="/lime-logo.webp" alt="LIME" className="h-8 w-auto shrink-0 select-none" />
              <div>
                <p className="font-black tracking-tight">LIME</p>
                <p className="text-xs font-semibold text-slate-400">
                  Panggilan meja & operasional resto
                </p>
              </div>
            </div>
            <div className="py-16">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-amber-400">
                {ownerLogin ? "Owner Console" : "Crew Workspace"}
              </p>
              <h2 className="mt-4 max-w-md text-4xl font-black leading-tight tracking-tight">
                Operasional resto yang cepat, jelas, dan terkendali.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
                Kelola layanan restoran dengan akses aman dan status operasional yang selalu
                terlihat.
              </p>
            </div>
            <p className="text-xs font-medium text-slate-500">Secure access · LIME</p>
          </section>

          <section className="bg-white p-6 text-slate-950 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-sm">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
                <div>
                  <p className="font-black tracking-tight">LIME</p>
                  <p className="text-[11px] font-semibold text-slate-500">Secure access</p>
                </div>
              </div>
              <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <LockKeyhole className="size-5" />
              </span>
              <h1 className="mt-6 text-3xl font-black tracking-tight">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Gunakan kredensial yang sudah diberikan untuk melanjutkan ke workspace.
              </p>

              <form onSubmit={submit} className="mt-8">
                <label className="block text-sm font-bold text-slate-700">
                  {instruction}
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    placeholder="Masukkan kredensial"
                    className="mt-2 min-h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-4 text-base outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                  />
                </label>

                {error && (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-extrabold text-white transition hover:bg-amber-500 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/25 disabled:opacity-50"
                >
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  {loading ? "Memverifikasi..." : submitLabel}
                  {!loading && <ArrowRight className="size-4" />}
                </button>
              </form>
              <p className="mt-6 text-center text-xs leading-5 text-slate-400">
                Akses dibatasi. Aktivitas login dapat dicatat untuk keamanan operasional.
              </p>
            </div>
          </section>
        </div>
      </div>
      <Footer className="mt-0 w-full border-t border-white/10 bg-slate-950 text-slate-400" />
    </main>
  );
}
