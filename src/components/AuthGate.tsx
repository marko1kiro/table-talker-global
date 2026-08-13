import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { login } from "@/lib/auth";
import { Footer } from "@/components/Footer";

interface AuthGateProps {
  onSuccess: () => Promise<void> | void;
  title?: string;
  instruction?: string;
  submitLabel?: string;
  loginAction?: typeof login;
}

export function AuthGate({
  onSuccess,
  title = "SIMPLE, SMART, SMOOTH !",
  instruction = "Masukkan kode resto dulu ya!",
  submitLabel = "Gassss!",
  loginAction = login,
}: AuthGateProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await loginAction({ data: { password } });
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

  return (
    <main className="flex min-h-[100svh] flex-col bg-background">
      <div className="flex flex-1 items-start justify-center px-4 pb-8 pt-[clamp(2rem,9vh,5.5rem)] sm:px-6">
        <form
          onSubmit={submit}
          className="brutal-border brutal-shadow-lg w-full max-w-sm bg-card p-5 sm:max-w-md sm:p-8"
        >
          <img
            src="/table-talker-logo.webp"
            alt="Table Talker Soundboard"
            width={440}
            height={376}
            className="mx-auto h-auto w-full max-w-[220px] sm:max-w-[250px]"
          />

          <h1 className="mt-4 text-center font-display text-lg uppercase sm:text-xl">{title}</h1>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            🙏 Jangan lupa Baca Do'a Dulu 🙏
          </p>

          <div className="mt-5 space-y-3 sm:mt-6">
            <label className="block text-xs font-bold uppercase">
              {instruction}
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                required
                className="brutal-border mt-1 w-full bg-background px-3 py-2.5 font-normal normal-case outline-none focus:bg-accent/20"
              />
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="brutal-border mt-3 bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="brutal-border brutal-shadow brutal-press mt-5 flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 font-display uppercase disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Bentar…" : submitLabel}
          </button>
        </form>
      </div>
      <Footer className="mt-0 w-full" />
    </main>
  );
}
