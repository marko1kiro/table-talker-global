import { FormEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, Send } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeFrame } from "@/components/dashboard/ThemeFrame";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCrewLogout } from "@/hooks/use-crew-logout";
import { buildWhatsAppHelpUrl } from "@/lib/help-message";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Bantuan — LIME" },
      {
        name: "description",
        content:
          "Butuh bantuan atau menemukan error di LIME? Kirim laporan kendala langsung ke tim support via WhatsApp.",
      },
      { property: "og:title", content: "Bantuan — LIME" },
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
    <ThemeFrame>
      <div className="pb-10">
        <Header onLogout={logout} />
        <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
              <LifeBuoy className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">Butuh Bantuan?</h1>
            <p className="mt-3 text-sm leading-relaxed text-ta-gray-500 sm:text-base dark:text-ta-gray-400">
              Lagi ada error atau kendala saat pakai LIME? Isi form di bawah ini, laporan kamu
              langsung dikirim ke WhatsApp tim support.
            </p>

            <form className="mt-8 space-y-5" onSubmit={submit}>
              <label
                className="block text-sm font-bold text-ta-gray-900 dark:text-white"
                htmlFor="help-restaurant-code"
              >
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

              <label
                className="block text-sm font-bold text-ta-gray-900 dark:text-white"
                htmlFor="help-crew-name"
              >
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

              <label
                className="block text-sm font-bold text-ta-gray-900 dark:text-white"
                htmlFor="help-issue"
              >
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
                  className="rounded-xl bg-ta-error/10 px-3 py-2 text-sm font-bold text-ta-error"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 font-bold text-white transition hover:bg-brand-600"
              >
                <Send className="h-4 w-4" strokeWidth={2.5} />
                Kirim via WhatsApp
              </button>
            </form>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeFrame>
  );
}
