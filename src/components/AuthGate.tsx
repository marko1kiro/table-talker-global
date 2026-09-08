import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, Loader2 } from "lucide-react";
import { Footer } from "@/components/Footer";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

export type SuperAdminLoginInput = {
  data: {
    mode: "legacy" | "individual";
    staffId?: string;
    password: string;
    clientKey: string;
  };
};

interface AuthGateProps {
  onSuccess: () => Promise<void> | void;
  title?: string;
  instruction?: string;
  submitLabel?: string;
  /**
   * Super Admin gate: individual ID + password login, with the one-time
   * shared-password bootstrap login offered only while the bootstrap gate is
   * still open (the server rejects it after the cutover regardless).
   */
  staffLogin?: boolean;
  loginAction: (input: SuperAdminLoginInput) => Promise<{ ok: boolean; message?: string }>;
  bootstrapStateLoader?: () => Promise<unknown>;
}

export function AuthGate({
  onSuccess,
  title = "SIMPLE, SMART, SMOOTH !",
  instruction = "Masukkan kode resto dulu ya!",
  submitLabel = "Gassss!",
  staffLogin = false,
  loginAction,
  bootstrapStateLoader,
}: AuthGateProps) {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);

  useEffect(() => {
    if (!staffLogin || !bootstrapStateLoader) return;
    let mounted = true;
    bootstrapStateLoader()
      .then((state) => {
        if (mounted) setBootstrapOpen((state as { open?: boolean } | null)?.open === true);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [staffLogin, bootstrapStateLoader]);

  const submit = async (event: FormEvent<HTMLFormElement>, mode: "legacy" | "individual") => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await loginAction({
        data: {
          mode,
          staffId: mode === "individual" ? staffId : undefined,
          password,
          clientKey: getOwnerLoginClientKey(),
        },
      });
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

  const superAdminLogin = title === "Login Super Admin";

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
                {superAdminLogin ? "Super Admin Console" : "Crew Workspace"}
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

              <form
                onSubmit={(e) => void submit(e, staffLogin ? "individual" : "legacy")}
                className="mt-8"
              >
                {staffLogin && (
                  <label className="block text-sm font-bold text-slate-700">
                    ID Super Admin
                    <input
                      type="text"
                      value={staffId}
                      onChange={(event) => setStaffId(event.target.value)}
                      autoComplete="username"
                      required
                      placeholder="ID Super Admin"
                      className="mt-2 min-h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-4 text-base outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                    />
                  </label>
                )}
                <label className="mt-4 block text-sm font-bold text-slate-700">
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

              {staffLogin && bootstrapOpen && (
                <form
                  onSubmit={(e) => void submit(e, "legacy")}
                  className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
                >
                  <p className="text-xs font-bold text-amber-700">
                    Periode peralihan: login bootstrap satu kali untuk membuat akun Super Admin
                    individual pertama.
                  </p>
                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 min-h-10 w-full rounded-lg bg-amber-500 px-3 text-xs font-extrabold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    Login Bootstrap (Peralihan)
                  </button>
                </form>
              )}
              {staffLogin && (
                <p className="mt-4 text-center text-xs">
                  <a
                    href="/super-admin/recovery"
                    className="font-semibold text-slate-400 transition hover:text-amber-500"
                  >
                    Lupa password Super Admin?
                  </a>
                </p>
              )}
              <p className="mt-6 text-center text-xs leading-5 text-slate-400">
                Akses dibatasi. Aktivitas login dapat dicatat untuk keamanan operasional.
              </p>
            </div>
          </section>
        </div>
      </div>
      <Footer variant="dark" className="mt-0" />
    </main>
  );
}
