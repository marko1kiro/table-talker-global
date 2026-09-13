"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
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
import { AuthLayout, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { Footer } from "@/components/Footer";
import {
  crewClaimShift,
  crewConfirmPairing,
  crewMe,
  crewRequestPairing,
  crewValidateCode,
} from "@/lib/crew-auth.server";
import {
  getDeviceToken,
  crewSignInWithOtp,
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
// Markup conventions (AuthLayout, IconField, taPrimaryButtonClass, step dots,
// role cards, inline alert) mirror the previous crew login screen so the swap
// stays invisible to crew tablets already styled for TailAdmin.

export const PAIRING_WINDOW_MS = 15 * 60 * 1000; // mirrors crew_pairing_requests.expires_at

const OTP_EMAIL_BAD = "Kode tidak sesuai atau kedaluwarsa. Minta kode baru.";
const PROVIDER_DOWN = "Sistem login sedang dimatikan. Hubungi Manager.";
// GoTrue 429 (over_email_send_rate_limit): the user just knocked too often.
// The 13 Sep 2026 incident proved this must NOT wear the PROVIDER_DOWN suit.
const OTP_RATE_LIMITED = "Terlalu sering meminta kode. Tunggu 1 menit, lalu coba lagi.";
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

type Step = "boot" | "email" | "otpEmail" | "resto" | "waiting" | "checkin" | "kicked" | "disabled";

// checkin is a step, the pairing OTP is an inline expansion of waiting.
type Pairing = { requestId: string; expiresAt: number };
type RestoInfo = { restaurantId: string; restaurantName: string; fullName: string };

export type CrewLoginFlowProps = {
  onSsContinue: (identity: CrewSessionIdentity) => void;
  onRoleContinue: (identity: RoleSessionIdentity) => void;
};

const ROLE_META: Record<CrewRole, { icon: typeof Volume2; description: string }> = {
  ss: { icon: Volume2, description: "Panggil pelanggan lewat panggilan meja" },
  kasir: { icon: Wallet, description: "Tandai meja terisi saat transaksi masuk" },
  satgas: { icon: ShieldCheck, description: "Escort pelanggan & pantau status meja" },
  clear_up: { icon: Sparkles, description: "Kosongkan meja setelah selesai dibersihkan" },
};

const STEP_ORDER: Step[] = ["email", "otpEmail", "resto", "waiting", "checkin"];

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

export function CrewLoginFlow({ onSsContinue, onRoleContinue }: CrewLoginFlowProps) {
  const [step, setStep] = useState<Step>("boot");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [restoCode, setRestoCode] = useState("");
  const [resto, setResto] = useState<{ restaurantId: string; displayName: string } | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [showPairingOtp, setShowPairingOtp] = useState(false);
  // Restaurant identity known at boot/verify time (paired email) or set on
  // successful pairing confirmation; drives the checkin badge.
  const [info, setInfo] = useState<RestoInfo | null>(null);
  const [role, setRole] = useState<CrewRole | null>(null);
  // 1s heartbeat only while waiting: re-renders so formatCountdown/
  // pairingStale re-read Date.now(); the value itself is not displayed.
  const [tick, setTick] = useState(0);

  // Every authenticated transition needs a LIVE carrier JWT + the pinned
  // device token. getDeviceToken is a synchronous localStorage read, so one
  // helper replaces the six `if (!token || !device)` / `if (!token)` guards
  // that had drifted apart (different verdicts, some leaving busy stuck).
  // Returns null whenever the session is gone (post-verification => SESSION_LOST).
  async function sessionAndDevice(): Promise<{ token: string; device: string } | null> {
    const token = await refreshCarrierToken();
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
    setName("");
    setRestoCode("");
    setResto(null);
    setPairing(null);
    setShowPairingOtp(false);
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
    if (step !== "waiting") return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [step]);
  void tick;

  /**
   * Shared boot/post-OTP branch (§3.2 step 1 & 3): a valid session's pairing
   * state decides where the crew lands. unpairedTarget differs: bootstrap
   * STARTS at the email screen, verified accounts PROCEED to resto.
   */
  async function routeSession(
    accessToken: string,
    deviceToken: string,
    unpairedTarget: Step,
  ): Promise<void> {
    const me = await crewMe({ data: { accessToken, deviceToken } });
    if (!me.ok) {
      setStep("email");
      setError(me.code === "UNAUTHORIZED" ? SESSION_LOST : GENERIC);
      return;
    }
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
  }, []);

  async function sendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError("");
    const result = await crewSignInWithOtp(email.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.code === "RATE_LIMITED" ? OTP_RATE_LIMITED : PROVIDER_DOWN);
      return;
    }
    setOtp("");
    setStep("otpEmail");
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
        setShowPairingOtp(false);
        setError("");
        setStep("waiting");
        return;
      }
      if (result.code === "ALREADY_PAIRED") {
        await routeSession(session.token, session.device, "resto");
        return;
      }
      setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pairing || otp.length !== 6) return;
    setBusy(true);
    setError("");
    const session = await sessionAndDevice();
    if (!session) {
      setBusy(false);
      setError(SESSION_LOST);
      return;
    }
    const result = await crewConfirmPairing({
      data: { accessToken: session.token, requestId: pairing.requestId, otp },
    });
    setBusy(false);
    if (result.ok) {
      setOtp("");
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
      setShowPairingOtp(false);
      setOtp("");
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
    // crew on the checkin screen. Deterministic-checkedInAt: the retry
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
  const canContinue = Boolean(resto) && name.trim().length > 0;

  const primary = `${taPrimaryButtonClass} w-full`;
  const disabledButton =
    "flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-ta-gray-100 text-sm font-semibold text-ta-gray-400";
  const secondary =
    "inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600";
  const bigButton = (enabled: boolean) => (enabled ? primary : disabledButton);

  if (step === "boot") {
    return (
      <AuthLayout>
        <div className="flex min-h-[40svh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand-500" />
        </div>
      </AuthLayout>
    );
  }

  if (step === "kicked") {
    return (
      <AuthLayout>
        <RestoBadge name={info?.restaurantName ?? ""} />
        <Alert>{KICKED}</Alert>
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
        <p className="mt-4 text-center text-xs text-ta-gray-400">
          Aktivitas login dapat dicatat untuk keamanan operasional.
        </p>
        <Footer className="mt-6" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
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

      {step === "email" && (
        <form className="space-y-4" onSubmit={sendOtp}>
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
          <button
            type="submit"
            disabled={busy || !canSubmitEmail}
            className={bigButton(canSubmitEmail)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memproses..." : "Kirim Kode"}
          </button>
          <p className="text-center text-xs text-ta-gray-400">
            Sudah punya akun? kode dikirim ke email Anda
          </p>
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
          {error === OTP_EMAIL_BAD && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void crewSignInWithOtp(email.trim()).finally(() => setBusy(false));
              }}
              className={`${secondary} mx-auto flex`}
            >
              Kirim ulang kode
            </button>
          )}
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className={bigButton(otp.length === 6)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memproses..." : "Verifikasi"}
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
            <>
              {!showPairingOtp && (
                <button type="button" onClick={() => setShowPairingOtp(true)} className={primary}>
                  Sudah punya kode? Masukkan
                </button>
              )}
              {showPairingOtp && (
                <form className="space-y-4" onSubmit={confirmPairing}>
                  <IconField
                    icon={ShieldCheck}
                    id="pairing-otp"
                    aria-label="Kode pairing"
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
                  <button
                    type="submit"
                    disabled={busy || otp.length !== 6}
                    className={bigButton(otp.length === 6)}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {busy ? "Memproses..." : "Register Device"}
                  </button>
                </form>
              )}
            </>
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
