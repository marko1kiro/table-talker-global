import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useCrewLogout } from "@/hooks/use-crew-logout";

export const Route = createFileRoute("/terms-of-use")({
  head: () => ({
    meta: [
      { title: "Syarat Penggunaan — LIME" },
      {
        name: "description",
        content: "Syarat dan ketentuan penggunaan aplikasi LIME untuk crew dan restoran.",
      },
      { property: "og:title", content: "Syarat Penggunaan — LIME" },
      { property: "og:url", content: "/terms-of-use" },
    ],
    links: [{ rel: "canonical", href: "/terms-of-use" }],
  }),
  component: TermsOfUsePage,
});

function TermsOfUsePage() {
  const logout = useCrewLogout();
  return (
    <div className="min-h-screen bg-background pb-10">
      <Header readyCount={0} totalCount={0} onLogout={logout} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="brutal-border brutal-shadow-lg bg-card p-6 sm:p-10">
          <h1 className="font-display text-2xl uppercase leading-tight sm:text-4xl">
            Syarat Penggunaan
          </h1>
          <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
            Terakhir diperbarui: 28 Agustus 2026
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                1. Penerimaan Syarat
              </h2>
              <p className="mt-2">
                Dengan mengakses dan menggunakan LIME, Anda menyetujui syarat penggunaan ini. Jika
                tidak setuju, mohon untuk tidak menggunakan aplikasi.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                2. Akses & Kode Resto
              </h2>
              <p className="mt-2">
                Akses crew ke aplikasi menggunakan Kode Resto yang diberikan oleh administrator
                restoran masing-masing. Kode Resto bersifat rahasia dan tidak boleh dibagikan ke
                pihak yang tidak berwenang.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                3. Penggunaan yang Wajar
              </h2>
              <p className="mt-2">
                Aplikasi ini ditujukan untuk keperluan operasional panggilan meja dan pengumuman di
                lingkungan restoran. Dilarang menyalahgunakan fitur untuk tujuan di luar operasional
                restoran, termasuk mengganggu sistem atau mencoba mengakses data restoran lain.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                4. Ketersediaan Layanan
              </h2>
              <p className="mt-2">
                Kami berupaya menjaga aplikasi tetap tersedia dan andal, namun tidak menjamin
                layanan bebas dari gangguan, kesalahan, atau waktu henti (downtime). Fitur tertentu
                dapat berubah, ditambah, atau dihentikan sewaktu-waktu.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                5. Batasan Tanggung Jawab
              </h2>
              <p className="mt-2">
                LIME disediakan "sebagaimana adanya". Kami tidak bertanggung jawab atas kerugian
                yang timbul dari penggunaan atau ketidaktersediaan layanan, termasuk namun tidak
                terbatas pada gangguan koneksi, perangkat, atau kebijakan browser.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">6. Konten Audio</h2>
              <p className="mt-2">
                Berkas audio yang digunakan pada katalog restoran menjadi tanggung jawab
                administrator restoran yang mengunggahnya. Pastikan konten yang diunggah sesuai
                dengan kebutuhan operasional dan tidak melanggar hak pihak lain.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">
                7. Perubahan Syarat
              </h2>
              <p className="mt-2">
                Syarat penggunaan ini dapat diperbarui sewaktu-waktu. Penggunaan aplikasi yang
                berkelanjutan setelah perubahan dianggap sebagai persetujuan atas syarat yang
                diperbarui.
              </p>
            </section>
            <section>
              <h2 className="font-display text-base uppercase text-foreground">8. Kontak</h2>
              <p className="mt-2">
                Pertanyaan seputar syarat penggunaan dapat disampaikan melalui halaman{" "}
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
