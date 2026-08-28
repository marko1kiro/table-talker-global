import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Kebijakan Privasi — Table Talker" },
      {
        name: "description",
        content:
          "Kebijakan privasi Table Talker: data apa yang dikumpulkan dan bagaimana digunakan.",
      },
      { property: "og:title", content: "Kebijakan Privasi — Table Talker" },
      { property: "og:url", content: "/privacy-policy" },
    ],
    links: [{ rel: "canonical", href: "/privacy-policy" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">
            Kebijakan Privasi
          </h1>
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Terakhir diperbarui: 28 Agustus 2026
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                1. Data yang Dikumpulkan
              </h2>
              <p className="mt-2">
                Table Talker mengumpulkan data operasional minimal yang diperlukan agar soundboard
                berfungsi, antara lain: kode resto, nama tampilan crew (dibuat otomatis), sesi
                perangkat, dan catatan aktivitas pemutaran audio (waktu, nomor meja/pengumuman yang
                diputar).
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                2. Cara Penggunaan Data
              </h2>
              <p className="mt-2">
                Data digunakan untuk memvalidasi akses restoran, menjaga sesi crew tetap sinkron,
                menampilkan status ketersediaan audio, serta membantu administrator restoran
                memantau aktivitas operasional dan menyelesaikan kendala teknis.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                3. Penyimpanan Lokal
              </h2>
              <p className="mt-2">
                Berkas audio yang telah disinkronkan disimpan sementara di penyimpanan cache browser
                (Cache Storage) pada perangkat crew agar pemutaran lebih cepat. Identitas sesi crew
                disimpan di session storage browser dan akan hilang saat tab ditutup.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">4. Berbagi Data</h2>
              <p className="mt-2">
                Data restoran dipisahkan secara ketat per tenant. Kami tidak menjual atau membagikan
                data pengguna kepada pihak ketiga di luar penyedia infrastruktur yang digunakan
                untuk menjalankan layanan (mis. penyimpanan objek dan basis data).
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">5. Keamanan</h2>
              <p className="mt-2">
                Akses ke dashboard, katalog audio, dan panel administrasi dilindungi kredensial dan
                sesi yang divalidasi di server. Kami menerapkan praktik keamanan yang wajar untuk
                melindungi data operasional restoran.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                6. Perubahan Kebijakan
              </h2>
              <p className="mt-2">
                Kebijakan ini dapat diperbarui sewaktu-waktu. Perubahan signifikan akan dicerminkan
                pada tanggal pembaruan di halaman ini.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">7. Kontak</h2>
              <p className="mt-2">
                Pertanyaan seputar privasi dapat disampaikan melalui halaman{" "}
                <a href="/contact" className="font-bold text-foreground underline">
                  Kontak
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
