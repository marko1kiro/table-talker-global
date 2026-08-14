import { FormEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CrewSessionIdentity } from "@/lib/crew-session-identity";
import { normalizeCrewName } from "@/lib/remote-audio-domain";

export type CrewIdentity = CrewSessionIdentity & { audioReady: boolean };

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
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = normalizeCrewName(name);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    setError("");
    const audioReady = await unlockAudio();
    onContinue({ ...result, audioReady });
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
        <DialogTitle className="font-display text-xl">
          Bentar, tolong isi nama kamu dulu ya!
        </DialogTitle>
        <DialogDescription id="crew-identity-description">
          Nama ini dipakai untuk remote control soundboard.
        </DialogDescription>
        <form className="space-y-4" onSubmit={submit}>
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
            LANJUT!!
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
