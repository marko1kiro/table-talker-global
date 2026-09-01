import { createFileRoute } from "@tanstack/react-router";
import { Volume2, Zap, ShieldCheck, Radio } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useCrewLogout } from "@/hooks/use-crew-logout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Tentang — Table Talker" },
      {
        name: "description",
        content:
          "Table Talker adalah soundboard panggilan meja untuk restoran. Kenali cara kerja dan tujuan aplikasi ini.",
      },
      { property: "og:title", content: "Tentang — Table Talker" },
      { property: "og:url", content: "/about" },
    ],
    links: [{ rel: "canonical", href: "/about" }],
  }),
  component: AboutPage,
});

const points = [
  {
    icon: Volume2,
    title: "Soundboard Panggilan Meja",
    body: "Tap nomor meja untuk memutar rekaman panggilan otomatis, sehingga crew tidak perlu berteriak manual di area dapur atau kasir.",
  },
  {
    icon: Zap,
    title: "Cepat & Ringan",
    body: "Audio disinkronkan dan disimpan di cache browser, jadi pemutaran instan begitu tombol ditekan tanpa jeda loading berulang.",
  },
  {
    icon: ShieldCheck,
    title: "Akses Terbatas per Restoran",
    body: "Setiap crew login memakai kode resto unik. Katalog audio, sesi, dan riwayat dipisahkan per tenant restoran.",
  },
  {
    icon: Radio,
    title: "Terus Dikembangkan",
    body: "Aplikasi ini terus disempurnakan agar operasional panggilan meja di restoran makin praktis dan andal.",
  },
];

function AboutPage() {
  const logout = useCrewLogout();
  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} onLogout={logout} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">
            Tentang Table Talker
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Table Talker adalah aplikasi soundboard sederhana yang membantu crew restoran memanggil
            pelanggan mengambil pesanan hanya dengan menekan nomor meja. Tujuannya: operasional
            dapur/kasir jadi lebih cepat, rapi, dan konsisten.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {points.map(({ icon: Icon, title, body }) => (
              <div key={title} className="brutal-border brutal-shadow-sm bg-background p-4">
                <div className="brutal-border mb-3 inline-flex h-10 w-10 items-center justify-center bg-accent">
                  <Icon className="h-5 w-5" strokeWidth={3} />
                </div>
                <h2 className="font-display text-base uppercase">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
