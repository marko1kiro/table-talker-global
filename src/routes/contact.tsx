import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle, Clock } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeFrame } from "@/components/dashboard/ThemeFrame";
import { useCrewLogout } from "@/hooks/use-crew-logout";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Kontak — LIME" },
      {
        name: "description",
        content: "Hubungi tim LIME untuk pertanyaan, kendala teknis, atau kerja sama.",
      },
      { property: "og:title", content: "Kontak — LIME" },
      { property: "og:url", content: "/contact" },
    ],
    links: [{ rel: "canonical", href: "/contact" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  const logout = useCrewLogout();
  return (
    <ThemeFrame>
      <div className="pb-10">
        <Header onLogout={logout} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">Kontak</h1>
            <p className="mt-3 text-sm leading-relaxed text-ta-gray-500 sm:text-base dark:text-ta-gray-400">
              Ada pertanyaan, laporan bug, atau butuh bantuan setup restoran? Hubungi kami lewat
              saluran di bawah ini.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                  <Mail className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">Email</h2>
                <p className="mt-1.5 text-sm text-ta-gray-500 dark:text-ta-gray-400">
                  Kirim pertanyaan atau laporan masalah melalui email admin restoran Anda, atau
                  gunakan email support yang tertera pada dashboard pengelola.
                </p>
              </div>
              <div className="rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                  <MessageCircle className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  Dukungan Teknis
                </h2>
                <p className="mt-1.5 text-sm text-ta-gray-500 dark:text-ta-gray-400">
                  Untuk kendala login, sinkronisasi audio, atau kode resto yang tidak berfungsi,
                  hubungi administrator restoran tempat Anda bertugas.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" strokeWidth={2.5} />
              <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
                Waktu respons dapat bervariasi tergantung jam operasional restoran dan tim
                pendukung.
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeFrame>
  );
}
