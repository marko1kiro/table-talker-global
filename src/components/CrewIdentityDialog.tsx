import { FormEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CrewSessionIdentity } from "@/lib/crew-session-identity";
import { loginToRestaurant } from "@/lib/restaurants.server";

export type CrewIdentity = CrewSessionIdentity & { audioReady: boolean };

function getClientKey() {
  const key = window.localStorage.getItem("table-talker.login-client-key");
  if (key) return key;
  const next = crypto.randomUUID();
  window.localStorage.setItem("table-talker.login-client-key", next);
  return next;
}

function autoCrewName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}

export function CrewIdentityDialog({
  open,
  onContinue,
  unlockAudio,
}: {
  open: boolean;
  onContinue: (identity: CrewIdentity) => void;
  unlockAudio: () => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      const crewName = autoCrewName(result.displayName);
      const normalizedName = crewName.toLocaleLowerCase("id-ID");
      const audioReady = await unlockAudio();
      onContinue({
        displayName: crewName,
        normalizedName,
        audioReady,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.displayName,
        tenantToken: result.tenantToken,
        crewSessionId: "",
        crewSessionToken: "",
      });
    } catch {
      setError("Kode Resto salah.");
    }
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
            MASUK!!
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
