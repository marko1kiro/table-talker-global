import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle, Clock } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Kontak — Table Talker" },
      {
        name: "description",
        content: "Hubungi tim Table Talker untuk pertanyaan, kendala teknis, atau kerja sama.",
      },
      { property: "og:title", content: "Kontak — Table Talker" },
      { property: "og:url", content: "/contact" },
    ],
    links: [{ rel: "canonical", href: "/contact" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">Kontak</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Ada pertanyaan, laporan bug, atau butuh bantuan setup restoran? Hubungi kami lewat
            saluran di bawah ini.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="brutal-border brutal-shadow-sm bg-background p-4">
              <div className="brutal-border mb-3 inline-flex h-10 w-10 items-center justify-center bg-accent">
                <Mail className="h-5 w-5" strokeWidth={3} />
              </div>
              <h2 className="font-display text-base uppercase">Email</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Kirim pertanyaan atau laporan masalah melalui email admin restoran Anda, atau
                gunakan email support yang tertera pada dashboard pengelola.
              </p>
            </div>
            <div className="brutal-border brutal-shadow-sm bg-background p-4">
              <div className="brutal-border mb-3 inline-flex h-10 w-10 items-center justify-center bg-accent">
                <MessageCircle className="h-5 w-5" strokeWidth={3} />
              </div>
              <h2 className="font-display text-base uppercase">Dukungan Teknis</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Untuk kendala login, sinkronisasi audio, atau kode resto yang tidak berfungsi,
                hubungi administrator restoran tempat Anda bertugas.
              </p>
            </div>
          </div>

          <div className="brutal-border mt-6 flex items-start gap-3 bg-background p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={3} />
            <p className="text-sm text-muted-foreground">
              Waktu respons dapat bervariasi tergantung jam operasional restoran dan tim pendukung.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
