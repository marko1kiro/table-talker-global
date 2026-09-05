import { createFileRoute } from "@tanstack/react-router";
import { Volume2, Zap, ShieldCheck, Radio } from "lucide-react";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeFrame } from "@/components/dashboard/ThemeFrame";
import { useCrewLogout } from "@/hooks/use-crew-logout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Tentang — LIME" },
      {
        name: "description",
        content:
          "LIME adalah soundboard panggilan meja untuk restoran. Kenali cara kerja dan tujuan aplikasi ini.",
      },
      { property: "og:title", content: "Tentang — LIME" },
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
    <ThemeFrame>
      <div className="pb-10">
        <Header onLogout={logout} />
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">Tentang LIME</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ta-gray-500 sm:text-base dark:text-ta-gray-400">
              LIME adalah aplikasi soundboard sederhana yang membantu crew restoran memanggil
              pelanggan mengambil pesanan hanya dengan menekan nomor meja. Tujuannya: operasional
              dapur/kasir jadi lebih cepat, rapi, dan konsisten.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {points.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900"
                >
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                    <Icon className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">{title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ta-gray-500 dark:text-ta-gray-400">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeFrame>
  );
}
