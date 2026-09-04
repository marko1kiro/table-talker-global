import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookupResto() {
    if (!code.trim()) {
      setRestoName("");
      return;
    }
    try {
      const result = await loginToRestaurant({ data: { code } });
      setRestoName("error" in result ? "" : result.displayName);
    } catch {
      setRestoName("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (password !== confirm) {
      setError("Ketik ulang password tidak cocok.");
      return;
    }
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
            onBlur={lookupResto}
            required
            className="h-12 rounded-xl"
          />
          {restoName && <p className="text-sm font-semibold text-cyan-700">{restoName}</p>}
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-pw">
            Password
          </label>
          <Input
            id="r-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-12 rounded-xl"
          />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-confirm">
            Ketik Ulang Password
          </label>
          <Input
            id="r-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
