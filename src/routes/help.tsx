import { FormEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, Send } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCrewLogout } from "@/hooks/use-crew-logout";
import { buildWhatsAppHelpUrl } from "@/lib/help-message";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Bantuan — Table Talker" },
      {
        name: "description",
        content:
          "Butuh bantuan atau menemukan error di Table Talker? Kirim laporan kendala langsung ke tim support via WhatsApp.",
      },
      { property: "og:title", content: "Bantuan — Table Talker" },
      { property: "og:url", content: "/help" },
    ],
    links: [{ rel: "canonical", href: "/help" }],
  }),
  component: HelpPage,
});

function HelpPage() {
  const logout = useCrewLogout();
  const [restaurantCode, setRestaurantCode] = useState("");
  const [crewName, setCrewName] = useState("");
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = restaurantCode.trim();
    const trimmedName = crewName.trim();
    const trimmedIssue = issue.trim();

    if (!trimmedCode || !trimmedName || !trimmedIssue) {
      setError("Semua kolom wajib diisi ya bos.");
      return;
    }
    setError("");

    const url = buildWhatsAppHelpUrl(trimmedCode, trimmedName, trimmedIssue);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} onLogout={logout} />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <div className="brutal-border mb-4 inline-flex h-12 w-12 items-center justify-center bg-accent">
            <LifeBuoy className="h-6 w-6" strokeWidth={3} />
          </div>
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">
            Butuh Bantuan?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Lagi ada error atau kendala saat pakai Table Talker? Isi form di bawah ini, laporan kamu
            langsung dikirim ke WhatsApp tim support.
          </p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-bold" htmlFor="help-restaurant-code">
              Kode Resto
              <Input
                id="help-restaurant-code"
                value={restaurantCode}
                onChange={(event) => setRestaurantCode(event.target.value)}
                placeholder="Contoh: CKRBUL"
                autoComplete="off"
                required
                className="mt-1.5"
              />
            </label>

            <label className="block text-sm font-bold" htmlFor="help-crew-name">
              Nama Crew
              <Input
                id="help-crew-name"
                value={crewName}
                onChange={(event) => setCrewName(event.target.value)}
                placeholder="Nama kamu"
                autoComplete="off"
                required
                className="mt-1.5"
              />
            </label>

            <label className="block text-sm font-bold" htmlFor="help-issue">
              Jelaskan masalah/kendala yang muncul
              <Textarea
                id="help-issue"
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                placeholder="Contoh: Tombol meja 12 tidak bersuara padahal status SIAP."
                rows={5}
                required
                className="mt-1.5"
              />
            </label>

            {error && (
              <p
                role="alert"
                className="brutal-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="brutal-border brutal-shadow brutal-press flex w-full items-center justify-center gap-2 bg-accent px-4 py-3 font-display uppercase"
            >
              <Send className="h-4 w-4" strokeWidth={3} />
              Kirim via WhatsApp
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
