import { useRef, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff, Hash, Loader2, Lock } from "lucide-react";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Footer } from "@/components/Footer";
import {
  loginStaff,
  confirmManagerHandoff,
  reconcileManagerHandoff,
  cleanupManagerPendingSession,
} from "@/lib/staff-login.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  readPendingManagerHandoff,
  removePendingManagerHandoff,
  writePendingManagerHandoff,
} from "@/lib/manager-pending-handoff";
import { managerLoginHandoffCore, type ManagerHandoffIdentity } from "@/lib/manager-login-handoff";
import {
  browserManagerStorage,
  readManagerIdentity,
  removeManagerIdentity,
  writeManagerIdentity,
} from "@/lib/manager-session-identity";
import { getOwnerLoginClientKey } from "@/lib/owner-login-client-key";

export const Route = createFileRoute("/manager/login")({
  head: () => ({
    meta: [{ title: "Login Staf - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: StaffLoginPage,
});

function StaffLoginPage() {
  const navigate = useNavigate();
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // R6-C: one idempotency key per logical attempt. Kept until a DEFINITIVE
  // response arrives, so a retry after a lost response re-reserves the SAME
  // rate-limit reservation instead of double-counting. A thrown (transport)
  // failure keeps the key — the reservation outcome is unknown and the retry
  // must reuse it; only a definitive response (handled below) retires it.
  const attemptKeyRef = useRef<string>("");

  const canSubmit = staffId.trim().length > 0 && password.length > 0;

  async function runManagerHandoff(identity: ManagerHandoffIdentity, remindPassword = false) {
    const storage = browserManagerStorage();
    const handoff = await managerLoginHandoffCore(identity, {
      ensureAccessToken: () => ensureAnonAccessToken(getSupabaseBrowserClient()),
      getStorage: browserManagerStorage,
      writeIdentity: writeManagerIdentity,
      setReminderFlag: () => {
        if (remindPassword) sessionStorage.setItem("tt-password-reminder", "1");
      },
      navigate: () => navigate({ to: "/manager" }),
      confirmHandoff: async (managerToken, rateLimitReservationId) => {
        const r = await confirmManagerHandoff({ data: { managerToken, rateLimitReservationId } });
        return r?.ok === true;
      },
      reconcileHandoff: async (managerToken, rateLimitReservationId) => {
        const r = await reconcileManagerHandoff({ data: { managerToken, rateLimitReservationId } });
        return r?.verdict ?? "unknown";
      },
      cleanupPending: async (managerToken, rateLimitReservationId) => {
        const r = await cleanupManagerPendingSession({
          data: { managerToken, rateLimitReservationId },
        });
        if (r?.ok !== true) throw new Error("manager handoff cleanup failed");
      },
    });
    // Only terminal server evidence (or successful confirmation) retires the
    // recovery record. UNKNOWN/cleanup failure must resume this exact pair.
    if (handoff.ok || handoff.reason === "handoff_failed") {
      removePendingManagerHandoff(storage);
    }
    return handoff;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    // Resume an uncertain handoff before a fresh authentication attempt.  In
    // particular, never send its newly minted pending bearer as managerToken
    // to the mandatory old-credential revoker.
    const pending = readPendingManagerHandoff(browserManagerStorage());
    if (pending) {
      try {
        const handoff = await runManagerHandoff(pending);
        if (handoff.ok || handoff.reason === "handoff_failed") attemptKeyRef.current = "";
        if (!handoff.ok) setError("Gagal memulai sesi. Coba lagi.");
      } catch {
        setError("Gagal memulai sesi. Coba lagi.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!attemptKeyRef.current) attemptKeyRef.current = crypto.randomUUID();
    const attemptKey = attemptKeyRef.current;
    try {
      const result = await loginStaff({
        data: {
          staffId: staffId.trim(),
          password,
          clientKey: getOwnerLoginClientKey(),
          attemptKey,
          // R3-A: revoke the previous manager session held by this browser.
          managerToken: readManagerIdentity(browserManagerStorage())?.managerToken,
        },
      });
      if (!result.ok) {
        // A resolved failure is terminal. Transport loss throws and keeps the
        // key in the catch path below for authoritative reconciliation.
        attemptKeyRef.current = "";
        setError(result.message);
        return;
      }
      if (result.role === "manager") {
        const identity: ManagerHandoffIdentity = {
          idManager: result.idManager,
          fullName: result.fullName,
          restaurantId: result.restaurantId,
          restaurantDisplayName: result.restaurantDisplayName,
          restaurantCode: result.restaurantCode,
          managerToken: result.managerToken,
          rateLimitReservationId: result.rateLimitReservationId,
        };
        // Persist only a recoverable pending pair before browser-side work.
        // If reconciliation is UNKNOWN, a later submit resumes this handoff
        // rather than entering loginStaff with this token as an old session.
        writePendingManagerHandoff(browserManagerStorage(), identity);
        const handoff = await runManagerHandoff(identity, result.mustRemindPassword);
        if (!handoff.ok) {
          if (handoff.reason === "handoff_failed") attemptKeyRef.current = "";
          setError("Gagal memulai sesi. Coba lagi.");
          return;
        }
        attemptKeyRef.current = "";
        return;
      }
      // Area Manager: cookie session sudah dibuat server-side; redirect by role.
      // Review A4: satu role per browser — identitas manager lama dihapus.
      attemptKeyRef.current = "";
      removeManagerIdentity(browserManagerStorage());
      void navigate({ to: "/am" });
    } catch {
      // Lost response: keep attemptKeyRef so the retry re-reserves the SAME
      // reservation (a new key here would double-count the attempt).
      setError("Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ta-gray-500 transition hover:text-brand-500 dark:text-ta-gray-400 dark:hover:text-brand-400"
      >
        <ArrowLeft className="size-4" />
        Kembali
      </Link>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">Login Staf</h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Masukkan ID dan password untuk masuk ke dashboard Manager atau Area Manager.
        </p>
      </div>
      <form className="space-y-5" onSubmit={submit}>
        <IconField
          icon={Hash}
          aria-label="ID Staf"
          placeholder="ID Staf"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
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
        <Link to="/manager/forgot" className="font-semibold text-brand-500 hover:underline">
          Lupa password?
        </Link>
      </p>
      <Footer className="mt-6" />
    </AuthLayout>
  );
}
