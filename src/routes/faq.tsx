import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useCrewLogout } from "@/hooks/use-crew-logout";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — LIME" },
      {
        name: "description",
        content: "Pertanyaan yang sering diajukan seputar penggunaan LIME.",
      },
      { property: "og:title", content: "FAQ — LIME" },
      { property: "og:url", content: "/faq" },
    ],
    links: [{ rel: "canonical", href: "/faq" }],
  }),
  component: FaqPage,
});

const faqs = [
  {
    q: "Apa itu LIME?",
    a: "LIME adalah soundboard panggilan meja berbasis web. Crew restoran cukup menekan nomor meja untuk memutar rekaman panggilan pesanan otomatis.",
  },
  {
    q: "Bagaimana cara login sebagai crew?",
    a: "Masukkan Kode Resto yang diberikan oleh administrator restoran pada dialog yang muncul saat pertama membuka aplikasi.",
  },
  {
    q: "Kenapa audio tidak keluar suara saat pertama dibuka?",
    a: "Browser membatasi pemutaran audio otomatis. Aplikasi akan meminta izin lewat interaksi pertama (tombol LANJUT!!) untuk membuka akses audio. Jika masih terkunci, gunakan tombol Aktifkan Suara yang tersedia.",
  },
  {
    q: "Apakah audio bisa dipakai tanpa koneksi internet?",
    a: "Audio yang sudah tersinkron akan tersimpan di cache browser sehingga tetap bisa diputar meski koneksi sempat terputus. Sinkronisasi awal tetap memerlukan koneksi internet.",
  },
  {
    q: "Kenapa jumlah meja yang siap tidak sesuai?",
    a: "Katalog audio dikelola oleh administrator restoran. Jika ada nomor meja yang belum tersedia audionya, hubungi admin restoran Anda untuk melengkapi katalog.",
  },
  {
    q: "Apakah data saya aman?",
    a: "Setiap restoran memiliki data dan sesi yang terpisah. Akses diverifikasi melalui kode resto dan sesi crew yang tervalidasi di server.",
  },
];

function FaqPage() {
  const logout = useCrewLogout();
  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} onLogout={logout} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">
            Pertanyaan Umum
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Jawaban singkat untuk pertanyaan yang paling sering muncul seputar LIME.
          </p>

          <div className="mt-8 space-y-3">
            {faqs.map(({ q, a }) => (
              <details key={q} className="brutal-border brutal-shadow-sm group bg-background p-4">
                <summary className="cursor-pointer list-none font-display text-sm uppercase leading-snug marker:content-none sm:text-base">
                  <span className="mr-2 text-accent-foreground">Q.</span>
                  {q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
