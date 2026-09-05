import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeFrame } from "@/components/dashboard/ThemeFrame";
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
    <ThemeFrame>
      <div className="pb-10">
        <Header onLogout={logout} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">Syarat Penggunaan</h1>
            <p className="mt-2 text-xs font-bold uppercase text-ta-gray-500 dark:text-ta-gray-400">
              Terakhir diperbarui: 6 September 2026
            </p>

            <div className="mt-8 space-y-6 text-sm leading-relaxed text-ta-gray-500 sm:text-base dark:text-ta-gray-400">
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  1. Penerimaan Syarat
                </h2>
                <p className="mt-2">
                  Dengan mengakses dan menggunakan LIME, Anda menyetujui syarat penggunaan ini. Jika
                  tidak setuju, mohon untuk tidak menggunakan aplikasi.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  2. Akses &amp; Kredensial
                </h2>
                <p className="mt-2">
                  Akses crew ke aplikasi menggunakan Kode Resto yang diberikan oleh administrator
                  restoran masing-masing. Manager masuk menggunakan ID Manager dan password
                  miliknya. Kode Resto, ID Manager, dan password bersifat rahasia dan tidak boleh
                  dibagikan ke pihak yang tidak berwenang.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  3. Penggunaan yang Wajar
                </h2>
                <p className="mt-2">
                  Aplikasi ini ditujukan untuk keperluan operasional restoran: panggilan meja,
                  pengumuman, pengelolaan status meja real-time, konfirmasi duduk pelanggan lewat
                  QR, serta pemantauan oleh manager dan owner. Dilarang menyalahgunakan fitur untuk
                  tujuan di luar operasional restoran, termasuk mengubah status meja tanpa dasar
                  operasional yang nyata (misalnya memanipulasi konfirmasi QR), mengganggu sistem,
                  atau mencoba mengakses data restoran lain.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  4. Ketersediaan Layanan
                </h2>
                <p className="mt-2">
                  Kami berupaya menjaga aplikasi tetap tersedia dan andal, namun tidak menjamin
                  layanan bebas dari gangguan, kesalahan, atau waktu henti (downtime). Fitur
                  tertentu dapat berubah, ditambah, atau dihentikan sewaktu-waktu.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  5. Batasan Tanggung Jawab
                </h2>
                <p className="mt-2">
                  LIME disediakan "sebagaimana adanya". Kami tidak bertanggung jawab atas kerugian
                  yang timbul dari penggunaan atau ketidaktersediaan layanan, termasuk namun tidak
                  terbatas pada gangguan koneksi, perangkat, atau kebijakan browser.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  6. Konten Audio
                </h2>
                <p className="mt-2">
                  Berkas audio yang digunakan pada katalog restoran menjadi tanggung jawab
                  administrator restoran yang mengunggahnya. Pastikan konten yang diunggah sesuai
                  dengan kebutuhan operasional dan tidak melanggar hak pihak lain.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">
                  7. Perubahan Syarat
                </h2>
                <p className="mt-2">
                  Syarat penggunaan ini dapat diperbarui sewaktu-waktu. Penggunaan aplikasi yang
                  berkelanjutan setelah perubahan dianggap sebagai persetujuan atas syarat yang
                  diperbarui.
                </p>
              </section>
              <section>
                <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">8. Kontak</h2>
                <p className="mt-2">
                  Pertanyaan seputar syarat penggunaan dapat disampaikan melalui halaman{" "}
                  <a href="/contact" className="font-bold text-brand-500 underline">
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
    </ThemeFrame>
  );
}
