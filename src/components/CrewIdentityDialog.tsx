import { FormEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CrewSessionIdentity } from "@/lib/crew-session-identity";
import { normalizeCrewName } from "@/lib/remote-audio-domain";
import { loginToRestaurant } from "@/lib/restaurants.server";

export type CrewIdentity = CrewSessionIdentity & { audioReady: boolean };

type Step = "restaurant" | "name";

function getClientKey() {
  const key = window.localStorage.getItem("table-talker.login-client-key");
  if (key) return key;
  const next = crypto.randomUUID();
  window.localStorage.setItem("table-talker.login-client-key", next);
  return next;
}

export function CrewIdentityDialog({
  open,
  duplicateName,
  onContinue,
  unlockAudio,
}: {
  open: boolean;
  duplicateName: boolean;
  onContinue: (identity: CrewIdentity) => void;
  unlockAudio: () => Promise<boolean>;
}) {
  const [step, setStep] = useState<Step>("restaurant");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restaurantInfo, setRestaurantInfo] = useState<{
    restaurantId: string;
    restaurantDisplayName: string;
    tenantToken: string;
    crewSessionId: string;
    crewSessionToken: string;
  } | null>(null);

  const submitRestaurant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const clientKey = getClientKey();
      const result = await loginToRestaurant({ data: { code, clientKey } });
      if ("error" in result) {
        setError(result.error as string);
        setSubmitting(false);
        return;
      }
      setRestaurantInfo({
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.displayName,
        tenantToken: result.tenantToken,
        crewSessionId: "",
        crewSessionToken: "",
      });
      setStep("name");
    } catch {
      setError("Gagal terhubung ke server.");
    }
    setSubmitting(false);
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = normalizeCrewName(name);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    setError("");
    const audioReady = await unlockAudio();
    onContinue({
      ...result,
      audioReady,
      restaurantId: restaurantInfo!.restaurantId,
      restaurantDisplayName: restaurantInfo!.restaurantDisplayName,
      tenantToken: restaurantInfo!.tenantToken,
      crewSessionId: restaurantInfo!.crewSessionId,
      crewSessionToken: restaurantInfo!.crewSessionToken,
    });
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        aria-describedby="crew-identity-description"
        className="brutal-border brutal-shadow-lg [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        {step === "restaurant" ? (
          <>
            <DialogTitle className="font-display text-xl">Masukkan Kode Resto</DialogTitle>
            <DialogDescription id="crew-identity-description">
              Masukkan kode resto yang diberikan administrator.
            </DialogDescription>
            <form className="space-y-4" onSubmit={submitRestaurant}>
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
              {error && (
                <div
                  role="alert"
                  className="brutal-border bg-destructive px-3 py-2 text-sm text-destructive-foreground"
                >
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="brutal-border brutal-shadow brutal-press w-full bg-accent px-4 py-3 font-display disabled:opacity-60"
              >
                LANJUT!!
              </button>
            </form>
          </>
        ) : (
          <>
            <DialogTitle className="font-display text-xl">
              Halo dari {restaurantInfo?.restaurantDisplayName}!
            </DialogTitle>
            <DialogDescription id="crew-identity-description">
              Isi nama kamu untuk remote control soundboard.
            </DialogDescription>
            <form className="space-y-4" onSubmit={submitName}>
              <label className="block text-sm font-bold" htmlFor="crew-name">
                Nama kamu
              </label>
              <Input
                id="crew-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                autoFocus
              />
              {(error || duplicateName) && (
                <div
                  role="alert"
                  className="brutal-border bg-destructive px-3 py-2 text-sm text-destructive-foreground"
                >
                  {error || "Nama sedang dipakai crew yang online."}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
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
