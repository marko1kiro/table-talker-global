import { FormEvent, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  changeRestaurantCode,
  createRestaurant,
  viewRestaurantCode,
} from "@/lib/restaurants.server";

type Mode = "create" | "view" | "rotate";

export function RestaurantCredentialDialog({
  open,
  mode,
  restaurant,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  mode: Mode;
  restaurant?: { id: string; displayName: string };
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [displayNameConfirmation, setDisplayNameConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [codeConfirmation, setCodeConfirmation] = useState("");
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [viewedCode, setViewedCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const clear = () => {
    setDisplayName("");
    setDisplayNameConfirmation("");
    setCode("");
    setCodeConfirmation("");
    setSuperAdminPassword("");
    setViewedCode("");
    setShowCode(false);
    setError("");
  };

  useEffect(() => clear, []);

  const close = () => {
    clear();
    onOpenChange(false);
  };

  const reveal = async () => {
    if (!restaurant) return;
    setPending(true);
    setError("");
    const result = await viewRestaurantCode({ data: { restaurantId: restaurant.id } });
    if ("error" in result) setError(result.error ?? "Kode Resto tidak dapat ditampilkan.");
    else setViewedCode(result.code);
    setPending(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    const result =
      mode === "create"
        ? await createRestaurant({ data: { displayName, restaurantCode: code } })
        : await changeRestaurantCode({
            data: {
              restaurantId: restaurant!.id,
              displayNameConfirmation,
              restaurantCode: code,
              codeConfirmation,
              superAdminPassword,
            },
          });
    if ("error" in result) {
      setError(result.error ?? "Kode Resto tidak dapat disimpan.");
      setPending(false);
      return;
    }
    clear();
    setPending(false);
    onComplete();
    onOpenChange(false);
  };

  const title =
    mode === "create" ? "Buat Resto" : mode === "view" ? "Kode Resto" : "Ganti Kode Resto";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        aria-describedby="restaurant-credential-description"
        className="brutal-border brutal-shadow-lg"
      >
        <DialogTitle className="font-display text-xl">{title}</DialogTitle>
        <DialogDescription id="restaurant-credential-description">
          {restaurant ? restaurant.displayName : "Masukkan Nama Resto dan Kode Resto baru."}
        </DialogDescription>
        {mode === "view" ? (
          <div className="space-y-4">
            <Input aria-label="Kode Resto" type="password" value={viewedCode} readOnly />
            <button
              type="button"
              className="brutal-border brutal-press w-full bg-accent px-4 py-3 font-display"
              disabled={pending}
              onClick={() => void reveal()}
            >
              Tampilkan Kode Resto
            </button>
            {error && (
              <p role="alert" className="text-sm font-bold text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            {mode === "create" ? (
              <label className="block text-sm font-bold" htmlFor="restaurant-display-name">
                Nama Resto
                <Input
                  id="restaurant-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </label>
            ) : (
              <label className="block text-sm font-bold" htmlFor="restaurant-name-confirmation">
                Ketik ulang Nama Resto
                <Input
                  id="restaurant-name-confirmation"
                  value={displayNameConfirmation}
                  onChange={(event) => setDisplayNameConfirmation(event.target.value)}
                  required
                />
              </label>
            )}
            <label className="block text-sm font-bold" htmlFor="restaurant-new-code">
              Kode Resto
              <Input
                id="restaurant-new-code"
                type={showCode ? "text" : "password"}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            {mode === "rotate" && (
              <label className="block text-sm font-bold" htmlFor="super-admin-password">
                Password Super Admin
                <Input
                  id="super-admin-password"
                  type="password"
                  value={superAdminPassword}
                  onChange={(event) => setSuperAdminPassword(event.target.value)}
                  required
                />
              </label>
            )}
            {mode === "rotate" && (
              <label className="block text-sm font-bold" htmlFor="restaurant-code-confirmation">
                Ketik ulang Kode Resto
                <Input
                  id="restaurant-code-confirmation"
                  type={showCode ? "text" : "password"}
                  value={codeConfirmation}
                  onChange={(event) => setCodeConfirmation(event.target.value)}
                  required
                />
              </label>
            )}
            <button
              type="button"
              className="underline"
              onClick={() => setShowCode((value) => !value)}
            >
              Tampilkan input Kode Resto
            </button>
            {error && (
              <p role="alert" className="text-sm font-bold text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="brutal-border brutal-press w-full bg-accent px-4 py-3 font-display disabled:opacity-60"
            >
              {pending ? "Menyimpan..." : "Simpan"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
