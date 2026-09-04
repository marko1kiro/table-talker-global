"use client";

import { FormEvent, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Store,
  Unlock,
  User,
  UserCog,
  Volume2,
  Wallet,
} from "lucide-react";
import { IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { loginToRestaurant, verifyRestaurantPin } from "@/lib/restaurants.server";
import { normalizeCrewName } from "@/lib/remote-audio-domain";
import {
  CREW_ROLE_LABELS,
  CREW_ROLE_ORDER,
  jakartaCheckedInAtToIso,
} from "@/lib/role-session-domain";
import type { CrewRole } from "@/lib/role-session-domain";
import { claimRoleSession } from "@/lib/role-session.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { CrewSessionIdentity, RoleSessionIdentity } from "@/lib/crew-session-identity";

// Dedicated full-page login flow ("Login Khusus"), superseding the old
// modal-on-top-of-the-SS-soundboard approach. Previously RoleLoginFlow
// rendered as a Dialog while the SS dashboard (Header + SoundboardGrid)
// was still mounted underneath -- visually looking like "login masih
// menampilkan halaman SS". The parent route (src/routes/index.tsx) now
// mounts this component ONLY when there is no identity yet, and mounts
// the SS dashboard ONLY once an identity exists, so nothing from any
// role's dashboard is visible before login completes.
//
// Sequence: Kode Resto -> ID Resto (PIN, 4 digit, admin-issued -- added
// 2026-09-01 so a crew member who only knows/guesses a Kode Resto can't
// get into another restaurant's dashboard) -> Pilih Role (vertical list,
// resto name shown as a confirmation badge -- replaces the old separate
// "Konfirmasi Resto" yes/no dialog) -> Nama & Jam Kerja -> claim_role_session
// -> hand off.
//
// Theme: TailAdmin (white card + brand-blue accents + Outfit), shared by all 4
// roles including SS, before any role-specific dashboard styling kicks in.
//
// Option B (unchanged from the previous flow): SS's session continues to
// be created with crewSessionId/crewSessionToken as empty strings;
// signInAnonymously() here only satisfies claim_role_session's
// `auth.uid() is not null` check and runs for all 4 roles.

type Step = "code" | "pin" | "role" | "identity";

type LoginResult = {
  restaurantId: string;
  displayName: string;
  code: string;
  tenantToken: string;
};

export type RoleLoginFlowProps = {
  onSsContinue: (identity: CrewSessionIdentity) => void;
  onRoleContinue: (identity: RoleSessionIdentity) => void;
};

const ROLE_META: Record<CrewRole, { icon: typeof Volume2; description: string }> = {
  ss: { icon: Volume2, description: "Panggil pelanggan lewat panggilan meja" },
  kasir: {
    icon: Wallet,
    description: "Tandai meja terisi saat transaksi masuk",
  },
  satgas: {
    icon: ShieldCheck,
    description: "Escort pelanggan & pantau status meja",
  },
  clear_up: {
    icon: Sparkles,
    description: "Kosongkan meja setelah selesai dibersihkan",
  },
};

const STEP_ORDER: Step[] = ["code", "pin", "role", "identity"];

function onlyDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

export function RoleLoginFlow({ onSsContinue, onRoleContinue }: RoleLoginFlowProps) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [submittingPin, setSubmittingPin] = useState(false);
  const [role, setRole] = useState<CrewRole | null>(null);
  const [name, setName] = useState("");
  const [checkedInAt, setCheckedInAt] = useState("");
  const [identityError, setIdentityError] = useState("");
  const [submittingIdentity, setSubmittingIdentity] = useState(false);

  const backToCode = () => {
    setStep("code");
    setCodeError("");
    setLogin(null);
    setPin("");
    setPinError("");
    setRole(null);
    setName("");
    setCheckedInAt("");
    setIdentityError("");
  };

  const backToPin = () => {
    setStep("pin");
    setPin("");
    setPinError("");
    setRole(null);
    setName("");
    setCheckedInAt("");
    setIdentityError("");
  };

  const backToRole = () => {
    setStep("role");
    setRole(null);
    setName("");
    setCheckedInAt("");
    setIdentityError("");
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittingCode(true);
    setCodeError("");
    try {
      const result = await loginToRestaurant({ data: { code } });
      if ("error" in result) {
        setCodeError(result.error as string);
        setSubmittingCode(false);
        return;
      }
      setLogin({
        restaurantId: result.restaurantId,
        displayName: result.displayName,
        code: result.code,
        tenantToken: result.tenantToken,
      });
      setPin("");
      setPinError("");
      setStep("pin");
    } catch {
      setCodeError("Kode Resto salah.");
    }
    setSubmittingCode(false);
  };

  const submitPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!login) return;
    setSubmittingPin(true);
    setPinError("");
    try {
      const result = await verifyRestaurantPin({
        data: { tenantToken: login.tenantToken, pin },
      });
      if ("error" in result) {
        setPinError(result.error as string);
        setSubmittingPin(false);
        return;
      }
      setStep("role");
    } catch {
      setPinError("ID Resto salah.");
    }
    setSubmittingPin(false);
  };

  const submitIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!login || !role) return;
    setIdentityError("");
    const normalized = normalizeCrewName(name);
    if ("error" in normalized) {
      setIdentityError(normalized.error);
      return;
    }
    const iso = jakartaCheckedInAtToIso(checkedInAt);
    if (!iso) {
      setIdentityError("Tanggal & Jam Kerja wajib diisi dengan benar.");
      return;
    }
    setSubmittingIdentity(true);
    try {
      const accessToken = await ensureAnonAccessToken(getSupabaseBrowserClient());
      if (!accessToken) {
        setIdentityError("Gagal memulai sesi peran. Coba lagi.");
        setSubmittingIdentity(false);
        return;
      }
      const result = await claimRoleSession({
        data: {
          restaurantId: login.restaurantId,
          tenantToken: login.tenantToken,
          role,
          displayName: normalized.displayName,
          checkedInAt: iso,
          // C-01 remediation (Fase 1, 2026-09-02): claim_role_session is
          // now the authoritative PIN check, so the PIN entered at the
          // earlier "pin" step must be forwarded here too, not only to
          // verifyRestaurantPin. Held only in this component's state,
          // never written to storage.
          pin,
          accessToken,
        },
      });
      if (!result.ok) {
        setIdentityError(result.message);
        setSubmittingIdentity(false);
        return;
      }
      if (role === "ss") {
        onSsContinue({
          displayName: normalized.displayName,
          normalizedName: normalized.normalizedName,
          restaurantId: login.restaurantId,
          restaurantDisplayName: login.displayName,
          tenantToken: login.tenantToken,
          crewSessionId: "",
          crewSessionToken: "",
        });
        return;
      }
      onRoleContinue({
        restaurantId: login.restaurantId,
        restaurantDisplayName: login.displayName,
        restaurantCode: login.code,
        tenantToken: login.tenantToken,
        role,
        displayName: result.displayName,
        checkedInAt: result.checkedInAt,
        roleSessionId: result.sessionId,
        roleSessionToken: result.sessionToken,
        accessToken,
      });
    } catch {
      setIdentityError("Gagal memulai sesi peran. Coba lagi.");
    }
    setSubmittingIdentity(false);
  };

  const stepIndex = STEP_ORDER.indexOf(step);
  const canSubmitIdentity = name.trim().length > 0 && checkedInAt.trim().length > 0;

  return (
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-ta-gray-50 px-4 py-10 font-outfit sm:px-6">
      <div className="relative w-full max-w-md">
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

        <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-md sm:p-8">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-brand-50">
              <img src="/lime-logo.webp" alt="LIME" className="h-9 w-auto select-none" />
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-ta-gray-400">
              Login Crew
            </p>
          </div>

          {step === "code" && (
            <>
              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Login Dulu
              </h1>
              <div className="mt-5 mb-1 rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ta-gray-500">
                  Khusus Pimpinan Shift
                </p>
                <Link
                  to="/manager/login"
                  className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-brand-600"
                >
                  <UserCog className="size-4" /> Login MANAGER
                </Link>
              </div>
              <form className="mt-6 space-y-4" onSubmit={submitCode}>
                <IconField
                  icon={Store}
                  id="restaurant-code"
                  aria-label="Kode Resto"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Masukkan Kode Resto"
                  autoComplete="organization"
                  required
                  autoFocus
                />
                {codeError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {codeError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submittingCode}
                  className={`${taPrimaryButtonClass} w-full`}
                >
                  {submittingCode && <Loader2 className="size-4 animate-spin" />}
                  {submittingCode ? "Memeriksa..." : "Lanjutkan"}
                </button>
              </form>
            </>
          )}

          {step === "pin" && login && (
            <>
              <button
                type="button"
                onClick={backToCode}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti Kode Resto
              </button>

              <div className="mb-5 flex justify-center">
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span className="truncate">{login.displayName}</span>
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                ID Resto
              </h1>
              <p className="mt-1 text-center text-sm text-ta-gray-500">
                Masukkan ID Resto (4 digit) yang diberikan admin untuk resto ini.
              </p>
              <form className="mt-6 space-y-4" onSubmit={submitPin}>
                <IconField
                  icon={KeyRound}
                  id="restaurant-pin"
                  aria-label="ID Resto"
                  value={pin}
                  onChange={(event) => setPin(onlyDigits(event.target.value, 4))}
                  placeholder="0000"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  required
                  autoFocus
                  className="text-center text-lg font-black tracking-[0.4em]"
                />
                {pinError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {pinError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submittingPin || pin.length !== 4}
                  className={`${taPrimaryButtonClass} w-full`}
                >
                  {submittingPin && <Loader2 className="size-4 animate-spin" />}
                  {submittingPin ? "Memeriksa..." : "Lanjutkan"}
                </button>
              </form>
            </>
          )}

          {step === "role" && login && (
            <>
              <button
                type="button"
                onClick={backToPin}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti ID Resto
              </button>

              <div className="mb-5 flex justify-center">
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span className="truncate">{login.displayName}</span>
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Pilih Station
              </h1>
              <p className="mt-1 text-center text-sm text-ta-gray-500">
                Pilih station kamu untuk melanjutkan.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {CREW_ROLE_ORDER.map((option) => {
                  const meta = ROLE_META[option];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setRole(option);
                        setStep("identity");
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-ta-gray-200 bg-white px-4 py-3.5 text-left shadow-theme-xs transition hover:border-brand-300 hover:bg-brand-50/40"
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
            </>
          )}

          {step === "identity" && role && login && (
            <>
              <button
                type="button"
                onClick={backToRole}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti Station
              </button>

              <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                  {CREW_ROLE_LABELS[role]}
                </span>
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  {login.displayName}
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Lengkapi Data
              </h1>
              <p className="mt-1 text-center text-sm text-ta-gray-500">
                Isi nama dan jam kerja kamu sebagai {CREW_ROLE_LABELS[role]}.
              </p>

              <form className="mt-6 space-y-4" onSubmit={submitIdentity}>
                <IconField
                  icon={User}
                  id="crew-name"
                  aria-label="Nama"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nama kamu"
                  required
                  autoFocus
                />
                <IconField
                  icon={Calendar}
                  id="checked-in-at"
                  aria-label="Tanggal & Jam Kerja"
                  type="datetime-local"
                  value={checkedInAt}
                  onChange={(event) => setCheckedInAt(event.target.value)}
                  required
                />
                {identityError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {identityError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={!canSubmitIdentity || submittingIdentity}
                  className={
                    canSubmitIdentity
                      ? `${taPrimaryButtonClass} w-full`
                      : "flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-ta-gray-100 text-sm font-semibold text-ta-gray-400"
                  }
                >
                  {submittingIdentity ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Memproses...
                    </>
                  ) : canSubmitIdentity ? (
                    <>
                      <Unlock className="size-4" /> Masuk
                    </>
                  ) : (
                    <>
                      <Lock className="size-4" /> Lengkapi Data
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-ta-gray-400">
          Aktivitas login dapat dicatat untuk keamanan operasional.
        </p>
      </div>
    </main>
  );
}
