import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { registerManager } from "@/lib/manager-auth.server";
import { loginToRestaurant } from "@/lib/restaurants.server";

export const Route = createFileRoute("/manager/register")({
  head: () => ({
    meta: [{ title: "Daftar Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerRegisterPage,
});

function ManagerRegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [idManager, setIdManager] = useState("");
  const [code, setCode] = useState("");
  const [restoName, setRestoName] = useState("");
  const [restoValid, setRestoValid] = useState(false);
  const [looking, setLooking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Debounced resto-code lookup: shows a loading state, then a checkmark once
  // the code resolves to a registered restaurant.
  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      setRestoName("");
      setRestoValid(false);
      setLooking(false);
      return;
    }
    setLooking(true);
    setRestoName("");
    setRestoValid(false);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await loginToRestaurant({ data: { code: trimmed } });
          if ("error" in result) {
            setRestoName("");
            setRestoValid(false);
          } else {
            setRestoName(result.displayName);
            setRestoValid(true);
          }
        } catch {
          setRestoName("");
          setRestoValid(false);
        } finally {
          setLooking(false);
        }
      })();
    }, 450);
    return () => clearTimeout(timer);
  }, [code]);

  const passwordWeak = password.length > 0 && password.length < 8;
  const confirmMismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    fullName.trim().length > 0 &&
    idManager.trim().length >= 3 &&
    code.trim().length > 0 &&
    restoValid &&
    password.length >= 8 &&
    confirm.length > 0 &&
    password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await registerManager({
        data: {
          idManager: idManager.trim().toLowerCase(),
          fullName: fullName.trim(),
          restaurantCode: code.trim(),
          password,
        },
      });
      if (!result.ok) {
        setError(
          result.code === "ID_MANAGER_TAKEN"
            ? "ID Manager sudah dipakai."
            : result.code === "RESTAURANT_NOT_FOUND"
              ? "Kode Resto tidak ditemukan."
              : "Pendaftaran gagal. Coba lagi.",
        );
        return;
      }
      void navigate({ to: "/manager/login" });
    } catch {
      setError("Pendaftaran gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <h1 className="text-center text-2xl font-black text-slate-900">Buat ID MANAGER BARU</h1>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-name">
            Nama Lengkap
          </label>
          <Input
            id="r-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="h-12 rounded-xl"
          />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-id">
            ID Manager
          </label>
          <Input
            id="r-id"
            value={idManager}
            onChange={(e) => setIdManager(e.target.value)}
            required
            className="h-12 rounded-xl"
          />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-code">
            Kode Resto
          </label>
          <Input
            id="r-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            className="h-12 rounded-xl"
          />
          <div className="min-h-[1.25rem] text-sm">
            {looking ? (
              <p className="flex items-center gap-2 font-semibold text-slate-500">
                <Loader2 className="size-4 animate-spin" /> Memeriksa kode resto...
              </p>
            ) : restoValid ? (
              <p className="flex items-center gap-1.5 font-semibold text-emerald-600">
                {restoName} <CheckCircle2 className="size-4 shrink-0" />
              </p>
            ) : code.trim() ? (
              <p className="font-semibold text-red-500">Kode Resto tidak ditemukan.</p>
            ) : null}
          </div>
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-pw">
            Password
          </label>
          <div className="relative">
            <Input
              id="r-pw"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12 rounded-xl pr-12"
            />
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          {passwordWeak && (
            <p className="text-xs font-semibold text-red-500">Password minimal 8 karakter.</p>
          )}
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-confirm">
            Ketik Ulang Password
          </label>
          <div className="relative">
            <Input
              id="r-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="h-12 rounded-xl pr-12"
            />
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          {confirmMismatch && (
            <p className="text-xs font-semibold text-red-500">Ketik ulang password tidak cocok.</p>
          )}
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
            disabled={!canSubmit || busy}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Menyimpan..." : "Submit"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <Link to="/manager/login" className="font-bold text-cyan-700 underline">
            Kembali ke Login Manager
          </Link>
        </p>
      </div>
    </main>
  );
}
