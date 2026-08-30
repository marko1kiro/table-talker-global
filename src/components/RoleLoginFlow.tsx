"use client";

import { FormEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { validateRestaurantCode } from "@/lib/restaurant-domain";
import { loginToRestaurant } from "@/lib/restaurants.server";
import { normalizeCrewName } from "@/lib/remote-audio-domain";
import { CREW_ROLE_LABELS, CREW_ROLE_ORDER, jakartaCheckedInAtToIso } from "@/lib/role-session-domain";
import type { CrewRole } from "@/lib/role-session-domain";
import { claimRoleSession } from "@/lib/role-session.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { CrewSessionIdentity, RoleSessionIdentity } from "@/lib/crew-session-identity";

// Task 8: revised login flow for all 4 roles (SS, Kasir, Satgas, Clear
// Up), superseding the old SS-only CrewIdentityDialog. Sequence per the
// design spec's "Login Flow (all 4 roles, final)" section: Kode Resto
// (plain text) -> confirmation dialog -> role picker -> manual Nama +
// Tanggal & Jam Masuk -> claim_role_session -> hand off to the caller.
//
// Option B (user decision, 2026-08-30): SS's session continues to be
// created exactly as today via CrewIdentity's crewSessionId/
// crewSessionToken always being empty strings -- this component never
// calls claim_crew_session, signInAnonymously()'s only purpose here is
// satisfying claim_role_session's `auth.uid() is not null` check, and it
// is performed for all 4 roles (not just SS), since every role now writes
// an audit-trail crew_role_sessions row via the same RPC.

type Step = "code" | "confirm" | "role" | "identity";

type LoginResult = { restaurantId: string; displayName: string; tenantToken: string };

export type RoleLoginFlowProps = {
  open: boolean;
  onSsContinue: (identity: CrewSessionIdentity) => void;
  onRoleContinue: (identity: RoleSessionIdentity) => void;
};

function getClientKey() {
  const key = window.localStorage.getItem("table-talker.login-client-key");
  if (key) return key;
  const next = crypto.randomUUID();
  window.localStorage.setItem("table-talker.login-client-key", next);
  return next;
}

export function RoleLoginFlow({ open, onSsContinue, onRoleContinue }: RoleLoginFlowProps) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [role, setRole] = useState<CrewRole | null>(null);
  const [name, setName] = useState("");
  const [checkedInAt, setCheckedInAt] = useState("");
  const [identityError, setIdentityError] = useState("");
  const [submittingIdentity, setSubmittingIdentity] = useState(false);

  const resetToCode = () => {
    setStep("code");
    setCode("");
    setCodeError("");
    setLogin(null);
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
      const clientKey = getClientKey();
      const result = await loginToRestaurant({ data: { code, clientKey } });
      if ("error" in result) {
        setCodeError(result.error as string);
        setSubmittingCode(false);
        return;
      }
      setLogin({
        restaurantId: result.restaurantId,
        displayName: result.displayName,
        tenantToken: result.tenantToken,
      });
      setStep("confirm");
    } catch {
      setCodeError("Kode Resto salah.");
    }
    setSubmittingCode(false);
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
      setIdentityError("Tanggal & Jam Masuk wajib diisi dengan benar.");
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

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        aria-describedby="role-login-description"
        className="brutal-border brutal-shadow-lg [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        {step === "code" && (
          <>
            <DialogTitle className="font-display text-xl">Masukkan Kode Resto</DialogTitle>
            <DialogDescription id="role-login-description">
              Masukkan kode resto yang diberikan administrator.
            </DialogDescription>
            <form className="space-y-4" onSubmit={submitCode}>
              <label className="block text-sm font-bold" htmlFor="restaurant-code">
                Kode Resto
              </label>
              <Input
                id="restaurant-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Kode Resto"
                autoComplete="organization"
                required
                autoFocus
              />
              {codeError && (
                <div
                  role="alert"
                  className="brutal-border bg-destructive px-3 py-2 text-sm text-destructive-foreground"
                >
                  {codeError}
                </div>
              )}
              <button
                type="submit"
                disabled={submittingCode}
                className="brutal-border brutal-shadow brutal-press w-full bg-accent px-4 py-3 font-display disabled:opacity-60"
              >
                MASUK!!
              </button>
            </form>
          </>
        )}

        {step === "confirm" && login && (
          <>
            <DialogTitle className="font-display text-xl">Konfirmasi Resto</DialogTitle>
            <DialogDescription id="role-login-description">
              Apakah kamu login ke Resto {login.displayName}?
            </DialogDescription>
            <div className="flex gap-3">
              <Button
                type="button"
                className="brutal-border brutal-shadow brutal-press flex-1 bg-accent font-display"
                onClick={() => setStep("role")}
              >
                YA
              </Button>
              <Button
                type="button"
                variant="outline"
                className="brutal-border brutal-press flex-1 font-display"
                onClick={resetToCode}
              >
                TIDAK
              </Button>
            </div>
          </>
        )}

        {step === "role" && (
          <>
            <DialogTitle className="font-display text-xl">Pilih Role</DialogTitle>
            <DialogDescription id="role-login-description">
              Pilih peran kamu untuk melanjutkan.
            </DialogDescription>
            <div className="grid grid-cols-2 gap-3">
              {CREW_ROLE_ORDER.map((option) => (
                <Button
                  key={option}
                  type="button"
                  className="brutal-border brutal-shadow brutal-press font-display"
                  onClick={() => {
                    setRole(option);
                    setStep("identity");
                  }}
                >
                  {CREW_ROLE_LABELS[option]}
                </Button>
              ))}
            </div>
          </>
        )}

        {step === "identity" && role && (
          <>
            <DialogTitle className="font-display text-xl">Data Masuk</DialogTitle>
            <DialogDescription id="role-login-description">
              Masukkan nama dan waktu masuk kamu sebagai {CREW_ROLE_LABELS[role]}.
            </DialogDescription>
            <form className="space-y-4" onSubmit={submitIdentity}>
              <label className="block text-sm font-bold" htmlFor="crew-name">
                Nama
              </label>
              <Input
                id="crew-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nama"
                required
                autoFocus
              />
              <label className="block text-sm font-bold" htmlFor="checked-in-at">
                Tanggal &amp; Jam Masuk
              </label>
              <Input
                id="checked-in-at"
                type="datetime-local"
                value={checkedInAt}
                onChange={(event) => setCheckedInAt(event.target.value)}
                required
              />
              {identityError && (
                <div
                  role="alert"
                  className="brutal-border bg-destructive px-3 py-2 text-sm text-destructive-foreground"
                >
                  {identityError}
                </div>
              )}
              <button
                type="submit"
                disabled={submittingIdentity}
                className="brutal-border brutal-shadow brutal-press w-full bg-accent px-4 py-3 font-display disabled:opacity-60"
              >
                MASUK!!
              </button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
