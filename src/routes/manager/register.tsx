import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, EyeOff, Hash, Loader2, Lock, Store, User } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
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
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Buat ID MANAGER BARU
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Daftarkan manager untuk restoran kamu.
        </p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <IconField
          icon={User}
          aria-label="Nama Lengkap"
          placeholder="Nama Lengkap"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          autoFocus
          required
        />
        <IconField
          icon={Hash}
          aria-label="ID Manager"
          placeholder="ID Manager"
          value={idManager}
          onChange={(e) => setIdManager(e.target.value)}
          required
        />
        <IconField
          icon={Store}
          aria-label="Kode Resto"
          placeholder="Kode Resto"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="organization"
          required
        />
        <div className="min-h-[1.25rem] text-sm">
          {looking ? (
            <p className="flex items-center gap-2 font-semibold text-ta-gray-500">
              <Loader2 className="size-4 animate-spin" /> Memeriksa kode resto...
            </p>
          ) : restoValid ? (
            <p className="flex items-center gap-1.5 font-semibold text-ta-success">
              {restoName} <CheckCircle2 className="size-4 shrink-0" />
            </p>
          ) : code.trim() ? (
            <p className="font-semibold text-ta-error">Kode Resto tidak ditemukan.</p>
          ) : null}
        </div>
        <IconField
          icon={Lock}
          aria-label="Password"
          placeholder="Password"
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
        {passwordWeak && (
          <p className="text-xs font-semibold text-ta-error">Password minimal 8 karakter.</p>
        )}
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
        {confirmMismatch && (
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
          {busy ? "Menyimpan..." : "Submit"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ta-gray-500 dark:text-ta-gray-400">
        <Link to="/manager/login" className="font-semibold text-brand-500 hover:underline">
          Kembali ke Login Manager
        </Link>
      </p>
    </AuthLayout>
  );
}
