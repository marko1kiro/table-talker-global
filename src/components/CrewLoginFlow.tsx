"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  Store,
  Unlock,
  User,
  Volume2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import {
  crewClaimShift,
  crewConfirmPairing,
  crewLoginMethod,
  crewMe,
  crewRequestPairing,
  crewValidateCode,
} from "@/lib/crew-auth.server";
import {
  getDeviceToken,
  crewSignInWithOtp,
  crewSignInWithPassword,
  crewSetPassword,
  crewSignOut,
  crewVerifyOtp,
  refreshCarrierToken,
} from "@/lib/browser-auth";
import { normalizeCrewName } from "@/lib/remote-audio-domain";
import { CREW_ROLE_LABELS, CREW_ROLE_ORDER } from "@/lib/role-session-domain";
import type { CrewRole } from "@/lib/role-session-domain";
import type { CrewSessionIdentity, RoleSessionIdentity } from "@/lib/crew-session-identity";

// Poin 3 Task 8 (spec §3.2): crew login on REAL email accounts. Replaces the
// anonymous "Kode + PIN" rails (Task 9 removed the old component and homepage
// mount). Steps: boot -> email -> otpEmail -> resto ->
// waiting (-> pairing input) -> checkin, plus the derived kicked/disabled
// screens (§7 copy). "Keluar akun" on the kick + checkin screens drops the
// GoTrue session (spec §12#5: role-session logout deliberately KEEPS it, so
// this is the only escape on a shared tablet). Authority is unchanged:
// role_session_tokens minted by crew_shift_claim, realtime/RPC keep refreshing
// the live JWT via refreshCarrierToken (Task 7).
//
// Poin 6.1: the magic link is demoted to a setup/reset tool. The flow is now
// email-first: submitEmail asks crewLoginMethod which door this account uses —
// password accounts go straight to the "Masuk" screen, everyone else keeps the
// OTP route — and EVERY OTP entry passes the mandatory "Buat Password" gate so
// the next login is a password, not an email round-trip. The pairing screen
// keeps its own empty field (otpPairing) instead of borrowing the login-code
// state (the email-code bleed this fixes), and transient post-login failures
// offer an in-place "Coba lagi" retry instead of dumping the crew back onto
// the email step (the loop-login bug).
//
// Markup conventions (AuthLayout, IconField, taPrimaryButtonClass, step dots,
// role cards, inline alert) mirror the previous crew login screen so the swap
// stays invisible to crew tablets already styled for TailAdmin.

export const PAIRING_WINDOW_MS = 15 * 60 * 1000; // mirrors crew_pairing_requests.expires_at

const OTP_EMAIL_BAD = "Kode tidak sesuai atau kedaluwarsa. Minta kode baru.";
const PROVIDER_DOWN = "Sistem login sedang dimatikan. Hubungi Manager.";
// GoTrue 429 (over_email_send_rate_limit): the user just knocked too often.
// The 13 Sep 2026 incident proved this must NOT wear the PROVIDER_DOWN suit.
const OTP_RATE_LIMITED = "Terlalu sering meminta kode. Tunggu 1 menit, lalu coba lagi.";
// Poin 5 G4: DB caps pairing requests at 5/uid/hour (crew_request_pairing).
const PAIRING_THROTTLED =
  "Terlalu sering meminta pairing. Tunggu sekitar satu jam atau hubungi Manager.";
// Session-loss copy, unified: any place a live carrier JWT / device token
// disappears AFTER the email was already verified, or the server reports the
// session is gone, lands on this one string. PROVIDER_DOWN stays reserved for
// a pre-verification email-send failure that is not a plain rate-limit (the
// only path where "login is off" is the honest diagnosis).
const SESSION_LOST = "Sesi login berakhir. Kirim kode lagi.";
const KICKED = "Akun ini dipakai login di perangkat lain.";
const DISABLED = "Akun kamu sudah dinonaktifkan. Hubungi Manager.";
const PAIR_STALE = "Permintaan ditolak/kedaluwarsa — mulai ulang";
const GENERIC = "Terjadi kesalahan. Coba lagi.";
// Poin 6.1 password-machine copy.
const PW_BAD_CREDENTIALS = "Email atau password salah.";
const PW_MISMATCH = "Ulangi password belum sama.";
const PW_MIN = "Password minimal 6 karakter.";
const LOOKUP_THROTTLED = "Terlalu sering mencoba. Tunggu sekitar 15 menit lalu coba lagi.";
const ROUTE_TRANSIENT = "Gagal memuat data. Coba lagi.";
const PW_SAVED_TOAST = "Password tersimpan";
const OTP_SENT_TOAST = "Kode dikirim ke email";

type Step =
  | "boot"
  | "email"
  | "password"
  | "otpEmail"
  | "setPassword"
  | "resto"
  | "waiting"
  | "checkin"
  | "kicked"
  | "disabled";

// checkin is a step, the pairing OTP is an inline expansion of waiting.
type Pairing = { requestId: string; expiresAt: number };
type RestoInfo = { restaurantId: string; restaurantName: string; fullName: string };

export type CrewLoginFlowProps = {
  onSsContinue: (identity: CrewSessionIdentity) => void;
  onRoleContinue: (identity: RoleSessionIdentity) => void;
  // Test seam (p1-3 resend cooldown): 0 disables the window.
  resendCooldownMs?: number;
  // Test seam (Poin 6.1): sessionAndDevice's single retry delay; 0 disables.
  sessionRetryMs?: number;
};

// 30 s between OTP emails per flow (the 13 Sep pajarhidayat double-send:
// two /otp requests 1.8 s apart — GoTrue invalidates the first code, so the
// user was typing a dead code from email #1).
const RESEND_COOLDOWN_MS = 30_000;

const ROLE_META: Record<CrewRole, { icon: typeof Volume2; description: string }> = {
  ss: { icon: Volume2, description: "Panggil pelanggan lewat panggilan meja" },
  kasir: { icon: Wallet, description: "Tandai meja terisi saat transaksi masuk" },
  satgas: { icon: ShieldCheck, description: "Escort pelanggan & pantau status meja" },
  clear_up: { icon: Sparkles, description: "Kosongkan meja setelah selesai dibersihkan" },
};

// Dots only render while wizardMode === "otp" (Poin 6.1: the password route
// has no wizard, so it shows no progress bar).
const STEP_ORDER: Step[] = ["email", "otpEmail", "setPassword", "resto", "waiting", "checkin"];

function onlyDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Alert({ children }: { children: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
    >
      {children}
    </div>
  );
}

function RestoBadge({ name }: { name: string }) {
  return (
    <div className="mb-5 flex justify-center">
      <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
        <CheckCircle2 className="size-4 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    </div>
  );
}

export function CrewLoginFlow({
  onSsContinue,
  onRoleContinue,
  resendCooldownMs = RESEND_COOLDOWN_MS,
  sessionRetryMs = 1_000,
}: CrewLoginFlowProps) {
  const [step, setStep] = useState<Step>("boot");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  // Pairing form code: its OWN state (Poin 6.1) — the login/email code state
  // must never leak into the manager-code field (and vice versa).
  const [otpPairing, setOtpPairing] = useState("");
  const [wizardMode, setWizardMode] = useState<"otp" | "password" | null>(null);
  const [badPassword, setBadPassword] = useState(false);
  // pw1 doubles as the LOGIN password and the NEW password: the password and
  // setPassword screens never coexist, so one field is honest, not shared.
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  // In-place retry for transient post-login failures (Poin 6.1 anti-loop):
  // set instead of bouncing to the email step; every post-email screen renders
  // a "Coba lagi" button while it is set.
  const [retryable, setRetryable] = useState<{ run: () => void } | null>(null);
  const lastRouteTarget = useRef<Step>("email");
  const [name, setName] = useState("");
  const [restoCode, setRestoCode] = useState("");
  const [resto, setResto] = useState<{ restaurantId: string; displayName: string } | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  // Restaurant identity known at boot/verify time (paired email) or set on
  // successful pairing confirmation; drives the checkin badge.
  const [info, setInfo] = useState<RestoInfo | null>(null);
  const [role, setRole] = useState<CrewRole | null>(null);
  // Resend cooldown deadline (epoch ms). While Date.now() < sendUntil both OTP
  // send doors (email-step submit + otp-screen resend) are disabled; the tick
  // heartbeat re-renders so the countdown expires without user interaction.
  const [sendUntil, setSendUntil] = useState(0);
  // 1s heartbeat only while waiting: re-renders so formatCountdown/
  // pairingStale re-read Date.now(); the value itself is not displayed.
  const [tick, setTick] = useState(0);

  // Every authenticated transition needs a LIVE carrier JWT + the pinned
  // device token. getDeviceToken is a synchronous localStorage read, so one
  // helper replaces the six `if (!token || !device)` / `if (!token)` guards
  // that had drifted apart (different verdicts, some leaving busy stuck).
  // Poin 6.1: one delayed retry on a null token (anti WiFi-kedip) before
  // declaring the session gone. Returns null whenever the session is gone
  // (post-verification => SESSION_LOST). Device is read once, AFTER the retry.
  async function sessionAndDevice(): Promise<{ token: string; device: string } | null> {
    let token = await refreshCarrierToken();
    if (!token && sessionRetryMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sessionRetryMs));
      token = await refreshCarrierToken();
    }
    const device = getDeviceToken();
    if (!token || !device) return null;
    return { token, device };
  }

  // Spec §12#5 escape hatch. Logging out of a ROLE page deliberately keeps the
  // email session (one login = one logged-in device), so on a shared tablet the
  // next crew would otherwise be greeted as the previous one and their shift
  // audited to the wrong account. This drops the GoTrue session AND every piece
  // of in-memory identity, landing on a blank email step. A failed sign-out is
  // not surfaced: the local state is cleared regardless, and the boot guard
  // re-routes on the next load if the session actually survived.
  async function signOutAccount(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await crewSignOut();
    } finally {
      setBusy(false);
    }
    setEmail("");
    setOtp("");
    setOtpPairing("");
    setWizardMode(null);
    setBadPassword(false);
    setPw1("");
    setPw2("");
    setName("");
    setRestoCode("");
    setResto(null);
    setPairing(null);
    setRetryable(null);
    setInfo(null);
    setRole(null);
    setError("");
    setStep("email");
  }

  const signOutButton = (label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => void signOutAccount()}
      className={`${secondary} mx-auto mt-4 flex`}
    >
      <LogOut className="size-3.5" /> {label}
    </button>
  );

  useEffect(() => {
    const cooling = sendUntil > Date.now();
    if (step !== "waiting" && !(cooling && (step === "email" || step === "otpEmail"))) return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [step, sendUntil]);
  void tick;

  /**
   * Shared boot/post-OTP branch (§3.2 step 1 & 3): a valid session's pairing
   * state decides where the crew lands. unpairedTarget differs: bootstrap
   * STARTS at the email screen, verified accounts PROCEED to resto.
   * Poin 6.1: the target is remembered for retries, and a NON-auth failure
   * keeps the crew on screen with a "Coba lagi" retry instead of bouncing to
   * the email step (the loop-login bug: session was fine, only the probe died).
   */
  async function routeSession(
    accessToken: string,
    deviceToken: string,
    unpairedTarget: Step,
  ): Promise<void> {
    lastRouteTarget.current = unpairedTarget;
    const me = await crewMe({ data: { accessToken, deviceToken } });
    if (!me.ok) {
      if (me.code === "UNAUTHORIZED") {
        setStep("email");
        setError(SESSION_LOST);
        setRetryable(null);
        return;
      }
      setError(ROUTE_TRANSIENT);
      setRetryable({
        run: () => void routeWithFreshSession(lastRouteTarget.current ?? "email"),
      });
      return;
    }
    setRetryable(null);
    if (!me.paired) {
      setStep(unpairedTarget);
      return;
    }
    if (me.status !== "aktif") {
      setStep("disabled");
      return;
    }
    setInfo({
      restaurantId: me.restaurantId ?? "",
      restaurantName: me.restaurantName ?? "",
      fullName: me.fullName ?? "",
    });
    setStep(me.deviceCurrent ? "checkin" : "kicked");
  }

  // Retry path for routeSession failures: re-read a live session (never trust
  // the possibly-dead token from the failed attempt), then route to the target
  // the crew was heading for.
  async function routeWithFreshSession(target: Step): Promise<void> {
    const session = await sessionAndDevice();
    if (!session) {
      setStep("email");
      setError(SESSION_LOST);
      setRetryable(null);
      return;
    }
    await routeSession(session.token, session.device, target);
  }

  // Mount-once by design: sessionAndDevice/routeSession are recreated every
  // render but the boot probe must run exactly one time per tab load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await sessionAndDevice();
      if (cancelled) return;
      if (!session) {
        setStep("email");
        return;
      }
      await routeSession(session.token, session.device, "email");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared OTP send used by submitEmail's otp branch AND the password screen's
  // "lupa" link: cooldown, error copy and landing spot stay identical.
  async function sendOtpRoundtrip() {
    const result = await crewSignInWithOtp(email.trim());
    if (!result.ok) {
      setBusy(false);
      setError(result.code === "RATE_LIMITED" ? OTP_RATE_LIMITED : PROVIDER_DOWN);
      return;
    }
    setSendUntil(Date.now() + resendCooldownMs);
    setOtp("");
    setWizardMode("otp");
    setStep("otpEmail");
    toast.success(OTP_SENT_TOAST);
    setBusy(false);
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !email.trim() || Date.now() < sendUntil) return;
    setBusy(true);
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    const verdict = await crewLoginMethod({ data: { email: normalizedEmail } });
    if (!verdict.ok) {
      setBusy(false);
      if (verdict.code === "THROTTLED") {
        setError(LOOKUP_THROTTLED);
        return;
      }
      setError(ROUTE_TRANSIENT);
      setRetryable({ run: () => void submitEmail(event) });
      return;
    }
    setRetryable(null);
    if (verdict.method === "password") {
      setWizardMode("password");
      setBadPassword(false);
      setPw1("");
      setStep("password");
      setBusy(false);
      return;
    }
    await sendOtpRoundtrip();
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pw1) return;
    setBusy(true);
    setError("");
    setBadPassword(false);
    const result = await crewSignInWithPassword(email.trim().toLowerCase(), pw1);
    if (result.ok) {
      // busy stays true across the whole routeSession hop: a re-entrant submit
      // while crewMe is in flight would otherwise land on a half-routed state.
      const session = await sessionAndDevice();
      if (!session) {
        setBusy(false);
        setError(SESSION_LOST);
        return;
      }
      await routeSession(session.token, session.device, "resto");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (result.code === "INVALID_CREDENTIALS") {
      setBadPassword(true);
      setError(PW_BAD_CREDENTIALS);
      return;
    }
    if (result.code === "RATE_LIMITED") {
      setError(OTP_RATE_LIMITED);
      return;
    }
    setError(ROUTE_TRANSIENT);
    setRetryable({ run: () => void submitPassword(event) });
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || otp.length !== 6) return;
    setBusy(true);
    setError("");
    const result = await crewVerifyOtp(email.trim(), otp);
    if (!result.ok) {
      setBusy(false);
      setError(OTP_EMAIL_BAD);
      return;
    }
    // Poin 6.1: verified OTP no longer routes — every OTP entry passes the
    // mandatory "Buat Password" gate first (submitSetPassword does the routing).
    setOtp("");
    setPw1("");
    setPw2("");
    setRetryable(null);
    setBusy(false);
    setStep("setPassword");
  }

  async function submitSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    // Local guards first: cheap mistakes never touch the network.
    if (pw1.length < 6) {
      setError(PW_MIN);
      return;
    }
    if (pw1 !== pw2) {
      setError(PW_MISMATCH);
      return;
    }
    setBusy(true);
    const result = await crewSetPassword(pw1);
    if (result.ok) {
      toast.success(PW_SAVED_TOAST);
      // busy stays true across the whole routeSession hop (old verifyOtp habit):
      // no re-entrant submit while crewMe is in flight.
      const session = await sessionAndDevice();
      if (!session) {
        setBusy(false);
        setError(SESSION_LOST);
        return;
      }
      await routeSession(session.token, session.device, "resto");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (result.code === "WEAK") {
      setError(PW_MIN);
      return;
    }
    // UNAVAILABLE: stay put, the session is intact — retry the save in place.
    setError(ROUTE_TRANSIENT);
    setRetryable({ run: () => void submitSetPassword(event) });
  }

  async function checkRestoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !restoCode.trim()) return;
    setBusy(true);
    setError("");
    const session = await sessionAndDevice();
    if (!session) {
      setBusy(false);
      setError(SESSION_LOST);
      return;
    }
    const result = await crewValidateCode({
      data: { accessToken: session.token, code: restoCode },
    });
    setBusy(false);
    if (!result.ok) {
      setResto(null);
      setError(result.message);
      return;
    }
    setResto({ restaurantId: result.restaurantId, displayName: result.displayName });
  }

  async function requestPairing() {
    if (busy || !resto) return;
    const normalized = normalizeCrewName(name);
    if ("error" in normalized) {
      setError(normalized.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const session = await sessionAndDevice();
      if (!session) {
        setError(SESSION_LOST);
        return;
      }
      const result = await crewRequestPairing({
        data: {
          accessToken: session.token,
          restaurantId: resto.restaurantId,
          fullName: normalized.displayName,
        },
      });
      if (result.ok) {
        setInfo({
          restaurantId: resto.restaurantId,
          restaurantName: resto.displayName,
          fullName: normalized.displayName,
        });
        setPairing({ requestId: result.requestId, expiresAt: Date.now() + PAIRING_WINDOW_MS });
        // Poin 6.1: the manager-code field is always visible on waiting and
        // must start EMPTY — never a leftover of the email/OTP code.
        setOtpPairing("");
        setError("");
        setStep("waiting");
        return;
      }
      if (result.code === "ALREADY_PAIRED") {
        await routeSession(session.token, session.device, "resto");
        return;
      }
      if (result.code === "PAIRING_THROTTLED") {
        setError(PAIRING_THROTTLED);
        return;
      }
      setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pairing || otpPairing.length !== 6) return;
    setBusy(true);
    setError("");
    const session = await sessionAndDevice();
    if (!session) {
      setBusy(false);
      setError(SESSION_LOST);
      return;
    }
    const result = await crewConfirmPairing({
      data: { accessToken: session.token, requestId: pairing.requestId, otp: otpPairing },
    });
    setBusy(false);
    if (result.ok) {
      setOtpPairing("");
      setStep("checkin");
      return;
    }
    // §7: burned/rejected/expired requests restart the pairing (the stale
    // banner below offers "Minta kode baru"); a plain wrong OTP keeps the
    // input open for the remaining attempts.
    if (
      result.code === "EXPIRED" ||
      result.code === "TOO_MANY_ATTEMPTS" ||
      result.code === "NOT_PENDING" ||
      result.code === "NOT_FOUND"
    ) {
      setPairing(null);
      setOtpPairing("");
      setError("");
      return;
    }
    if (result.code === "UNAUTHORIZED") {
      setStep("email");
      setError(SESSION_LOST);
      return;
    }
    setError(result.message);
  }

  async function claimShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !role) return;
    setBusy(true);
    setError("");
    const session = await sessionAndDevice();
    if (!session) {
      setBusy(false);
      setStep("email");
      setError(SESSION_LOST);
      return;
    }
    const { token: accessToken, device: deviceToken } = session;
    const payload = {
      data: { accessToken, role, checkedInAt: new Date().toISOString(), deviceToken },
    };
    let result = await crewClaimShift(payload);
    // §7: a network/transport failure surfaces as UNAVAILABLE (the core
    // maps thrown RPC errors to it) and gets exactly ONE silent retry; a
    // persistent failure then shows the generic message inline, keeping the
    // crew on the checkin screen. Deterministic checkedInAt: the retry
    // reuses the SAME payload, so the shift start never drifts between
    // attempts.
    if (!result.ok && result.code === "UNAVAILABLE") {
      result = await crewClaimShift(payload);
    }
    setBusy(false);
    if (!result.ok) {
      if (result.code === "ACCOUNT_DISABLED") {
        setStep("disabled");
        return;
      }
      if (result.code === "NOT_PAIRED" || result.code === "UNAUTHORIZED") {
        setStep("email");
        setError(result.message);
        return;
      }
      setError(result.message);
      return;
    }
    // Identity hand-off compatible with the existing index.tsx consumers
    // (crew-session-identity storage helpers): SS keeps the Option B shape
    // (empty crew session -> tenant audio still works), the 3 other roles get
    // the full RoleSessionIdentity. accessToken is the login-time snapshot;
    // every later RPC re-reads a live one via refreshCarrierToken (Task 14
    // pattern). tenantToken/restaurant fields are SERVER-derived from the
    // claim itself (crew_shift_claim), never client-supplied.
    if (result.role === "ss") {
      const normalized = normalizeCrewName(result.displayName);
      onSsContinue({
        displayName: result.displayName,
        normalizedName:
          "error" in normalized
            ? result.displayName.toLocaleLowerCase("id-ID")
            : normalized.normalizedName,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.restaurantName,
        tenantToken: result.tenantToken,
        crewSessionId: "",
        crewSessionToken: "",
      });
      return;
    }
    onRoleContinue({
      restaurantId: result.restaurantId,
      restaurantDisplayName: result.restaurantName,
      restaurantCode: result.restaurantCode,
      tenantToken: result.tenantToken,
      role: result.role,
      displayName: result.displayName,
      checkedInAt: result.checkedInAt,
      roleSessionId: result.sessionId,
      roleSessionToken: result.sessionToken,
      accessToken,
    });
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const pairingLeftMs = pairing ? pairing.expiresAt - Date.now() : 0;
  const pairingStale = !pairing || pairingLeftMs <= 0;
  const canSubmitEmail = email.trim().length > 0;
  const sendSecsLeft = Math.max(0, Math.ceil((sendUntil - Date.now()) / 1000));
  const canContinue = Boolean(resto) && name.trim().length > 0;

  const primary = `${taPrimaryButtonClass} w-full`;
  const disabledButton =
    "flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-ta-gray-100 text-sm font-semibold text-ta-gray-400";
  const secondary =
    "inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600";
  const bigButton = (enabled: boolean) => (enabled ? primary : disabledButton);

  // Poin 6.1 in-place retry: rendered directly under the Alert on every
  // post-email screen whenever a transient failure left a retry closure.
  const retryBlock = retryable && (
    <button
      type="button"
      disabled={busy}
      onClick={() => retryable.run()}
      className={`${secondary} mx-auto flex`}
    >
      Coba lagi
    </button>
  );

  // Show/hide eye, shared by the password + setPassword screens.
  const eyeToggle = (
    <button
      type="button"
      aria-label={showPw ? "Sembunyikan password" : "Tampilkan password"}
      onClick={() => setShowPw((v) => !v)}
      className="text-ta-gray-400 transition hover:text-ta-gray-600"
    >
      {showPw ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </button>
  );

  if (step === "boot") {
    return (
      <AuthLayout>
        <div className="flex min-h-[40svh] flex-col justify-center gap-4">
          <div className="animate-pulse space-y-4">
            <Skeleton className="mx-auto h-10 w-2/3 rounded-xl" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (step === "kicked") {
    return (
      <AuthLayout>
        <RestoBadge name={info?.restaurantName ?? ""} />
        <Alert>{KICKED}</Alert>
        {retryBlock}
        <button type="button" onClick={() => setStep("checkin")} className={`${primary} mt-6`}>
          <Unlock className="size-4" /> Lanjut di perangkat ini
        </button>
        {signOutButton("Keluar akun")}
        <Footer className="mt-6" />
      </AuthLayout>
    );
  }

  if (step === "disabled") {
    return (
      <AuthLayout>
        <div className="mb-5 flex flex-col items-center text-center">
          <img src="/lime-logo.webp" alt="LIME" className="mb-3 h-10 w-auto" />
          <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Akun Tidak Aktif</h1>
        </div>
        <Alert>{DISABLED}</Alert>
        {retryBlock}
        <p className="mt-4 text-center text-xs text-ta-gray-400">
          Aktivitas login dapat dicatat untuk keamanan operasional.
        </p>
        <Footer className="mt-6" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      {wizardMode === "otp" && (
        <div className="mb-5 flex items-center justify-center gap-2">
          {STEP_ORDER.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? "w-8 bg-brand-500"
                  : i < stepIndex
                    ? "w-4 bg-brand-300"
                    : "w-4 bg-ta-gray-200"
              }`}
            />
          ))}
        </div>
      )}

      {step === "email" && (
        <form className="space-y-4" onSubmit={submitEmail}>
          <div className="mb-2 flex flex-col items-center text-center">
            <img src="/lime-logo.webp" alt="LIME" className="mb-3 h-10 w-auto" />
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Login Crew</h1>
            <p className="mt-1 text-sm text-ta-gray-500">
              Masukkan email kamu. Kode login 6 digit akan dikirim ke email.
            </p>
          </div>
          <IconField
            icon={Mail}
            id="crew-email"
            aria-label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nama@contoh.com"
            autoComplete="email"
            required
            autoFocus
          />
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          <button
            type="submit"
            disabled={busy || !canSubmitEmail || sendSecsLeft > 0}
            className={bigButton(canSubmitEmail)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memproses..." : sendSecsLeft > 0 ? `Tunggu ${sendSecsLeft} dtk` : "Lanjut"}
          </button>
          <p className="text-center text-xs text-ta-gray-400">
            Sudah punya akun? kode dikirim ke email Anda
          </p>
        </form>
      )}

      {step === "password" && (
        <form className="space-y-4" onSubmit={submitPassword}>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setWizardMode(null);
              setError("");
            }}
            className={secondary}
          >
            <ArrowLeft className="size-3.5" /> Ganti email
          </button>
          <div className="mb-2 flex flex-col items-center text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Masuk</h1>
            <p className="mt-1 text-sm text-ta-gray-500">{email.trim()}</p>
          </div>
          <IconField
            icon={Unlock}
            id="crew-password"
            aria-label="Password"
            type={showPw ? "text" : "password"}
            value={pw1}
            onChange={(event) => setPw1(event.target.value)}
            placeholder="Password kamu"
            autoComplete="current-password"
            required
            autoFocus
            trailing={eyeToggle}
          />
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          {badPassword && (
            <button
              type="button"
              disabled={busy || Date.now() < sendUntil}
              onClick={() => {
                setBusy(true);
                setError("");
                void sendOtpRoundtrip();
              }}
              className={`${secondary} mx-auto flex`}
            >
              Belum bisa masuk? Kirim kode email
            </button>
          )}
          <button type="submit" disabled={busy || !pw1} className={bigButton(pw1.length > 0)}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memproses..." : "Masuk"}
          </button>
        </form>
      )}

      {step === "otpEmail" && (
        <form className="space-y-4" onSubmit={verifyOtp}>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setError("");
            }}
            className={secondary}
          >
            <ArrowLeft className="size-3.5" /> Ganti email
          </button>
          <p className="text-center text-sm text-ta-gray-500">
            Masukkan 6 digit kode yang dikirim ke <b>{email.trim()}</b>.
          </p>
          <IconField
            icon={Mail}
            id="crew-otp"
            aria-label="Kode email"
            value={otp}
            onChange={(event) => setOtp(onlyDigits(event.target.value, 6))}
            placeholder="000000"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            className="text-center text-lg font-black tracking-[0.4em]"
          />
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          {error === OTP_EMAIL_BAD && (
            <button
              type="button"
              disabled={busy || Date.now() < sendUntil}
              onClick={() => {
                setBusy(true);
                setError("");
                void crewSignInWithOtp(email.trim())
                  .then((r) => {
                    if (r.ok) setSendUntil(Date.now() + resendCooldownMs);
                    else setError(r.code === "RATE_LIMITED" ? OTP_RATE_LIMITED : PROVIDER_DOWN);
                  })
                  .finally(() => setBusy(false));
              }}
              className={`${secondary} mx-auto flex`}
            >
              {sendSecsLeft > 0 ? `Kirim ulang kode dalam ${sendSecsLeft} dtk` : "Kirim ulang kode"}
            </button>
          )}
          <button
            type="submit"
            aria-label="Verifikasi"
            disabled={busy || otp.length !== 6}
            className={bigButton(otp.length === 6)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memproses..." : "Verifikasi"}
          </button>
        </form>
      )}

      {step === "setPassword" && (
        <form className="space-y-4" onSubmit={submitSetPassword}>
          <div className="mb-2 flex flex-col items-center text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Buat Password</h1>
            <p className="mt-1 text-sm text-ta-gray-500">
              Password dipakai untuk login berikutnya, tanpa kode email.
            </p>
          </div>
          <IconField
            icon={Unlock}
            id="crew-new-password"
            aria-label="Password baru"
            type={showPw ? "text" : "password"}
            value={pw1}
            onChange={(event) => setPw1(event.target.value)}
            placeholder="Minimal 6 karakter"
            autoComplete="new-password"
            required
            autoFocus
            trailing={eyeToggle}
          />
          <IconField
            icon={Unlock}
            id="crew-repeat-password"
            aria-label="Ulangi password"
            type={showPw ? "text" : "password"}
            value={pw2}
            onChange={(event) => setPw2(event.target.value)}
            placeholder="Ulangi password"
            autoComplete="new-password"
            required
          />
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          <button type="submit" disabled={busy} className={busy ? disabledButton : primary}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Menyimpan..." : "Simpan Password"}
          </button>
        </form>
      )}

      {step === "resto" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">
              Hubungkan ke Resto
            </h1>
            <p className="mt-1 text-sm text-ta-gray-500">
              Isi nama kamu dan Kode Resto, lalu minta persetujuan Manager.
            </p>
          </div>
          {resto && <RestoBadge name={resto.displayName} />}
          <IconField
            icon={User}
            id="crew-full-name"
            aria-label="Nama"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nama kamu"
            autoComplete="name"
            required
          />
          <form onSubmit={checkRestoCode} className="space-y-4">
            <IconField
              icon={Store}
              id="crew-resto-code"
              aria-label="Kode Resto"
              value={restoCode}
              onChange={(event) => {
                setRestoCode(event.target.value);
                setResto(null);
              }}
              placeholder="Masukkan Kode Resto"
              autoComplete="organization"
              required
            />
            {error && <Alert>{error}</Alert>}
            {retryBlock}
            <button
              type="submit"
              disabled={busy || !restoCode.trim()}
              className={bigButton(restoCode.trim().length > 0)}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Memproses..." : "Cek Kode"}
            </button>
          </form>
          <button
            type="button"
            disabled={busy || !canContinue}
            onClick={() => void requestPairing()}
            className={bigButton(canContinue)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Mengirim..." : "Lanjutkan"}
          </button>
        </div>
      )}

      {step === "waiting" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Menunggu Manager</h1>
            <p className="mt-1 text-sm text-ta-gray-500">
              Hubungi Manager untuk mendapatkan kode aktifasi
            </p>
          </div>
          {info?.restaurantName ? <RestoBadge name={info.restaurantName} /> : null}
          {pairing && (
            <p className="text-center text-xs text-ta-gray-400">
              No. permintaan {pairing.requestId.slice(0, 8).toUpperCase()} — berlaku{" "}
              <span className="font-bold tabular-nums">{formatCountdown(pairingLeftMs)}</span>
            </p>
          )}
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          {pairingStale ? (
            <>
              <Alert>{PAIR_STALE}</Alert>
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestPairing()}
                className={primary}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "Mengirim..." : "Minta kode baru"}
              </button>
            </>
          ) : (
            // Poin 6.1: the code form is ALWAYS visible (no "Sudah punya kode?"
            // reveal dance) and bound to its own empty field.
            <form className="space-y-4" onSubmit={confirmPairing}>
              <IconField
                icon={ShieldCheck}
                id="pairing-otp"
                aria-label="Kode dari Manager"
                value={otpPairing}
                onChange={(event) => setOtpPairing(onlyDigits(event.target.value, 6))}
                placeholder="000000"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                className="text-center text-lg font-black tracking-[0.4em]"
              />
              <button
                type="submit"
                disabled={busy || otpPairing.length !== 6}
                className={bigButton(otpPairing.length === 6)}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "Memproses..." : "Register Device"}
              </button>
            </form>
          )}
        </div>
      )}

      {step === "checkin" && (
        <div className="space-y-4">
          <div className="mb-1 flex flex-col items-center text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">Pilih Station</h1>
            <p className="mt-1 text-sm text-ta-gray-500">
              {info?.fullName ? `Halo ${info.fullName} — ` : ""}pilih station kamu. Jam login akan
              dicatat otomatis.
            </p>
          </div>
          {info?.restaurantName ? <RestoBadge name={info.restaurantName} /> : null}
          <div className="flex flex-col gap-3">
            {CREW_ROLE_ORDER.map((option) => {
              const meta = ROLE_META[option];
              const Icon = meta.icon;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={role === option}
                  onClick={() => setRole(option)}
                  className={`group flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3.5 text-left shadow-theme-xs transition hover:border-brand-300 hover:bg-brand-50/40 ${
                    role === option
                      ? "border-brand-500 ring-2 ring-brand-500/20"
                      : "border-ta-gray-200"
                  }`}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ta-gray-900">
                      {CREW_ROLE_LABELS[option]}
                    </span>
                    <span className="block truncate text-xs text-ta-gray-500">
                      {meta.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {error && <Alert>{error}</Alert>}
          {retryBlock}
          <form onSubmit={claimShift}>
            <button type="submit" disabled={busy || !role} className={bigButton(Boolean(role))}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Memproses...
                </>
              ) : (
                <>
                  <Unlock className="size-4" /> Masuk
                </>
              )}
            </button>
          </form>
          {signOutButton(`Bukan ${info?.fullName ?? "kamu"}? Keluar`)}
        </div>
      )}

      <p className="mt-6 text-center text-xs leading-5 text-ta-gray-400">
        Aktivitas login dapat dicatat untuk keamanan operasional.
      </p>
      <Footer className="mt-6" />
    </AuthLayout>
  );
}
