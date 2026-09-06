import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeFrame } from "@/components/dashboard/ThemeFrame";
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
    a: "LIME adalah sistem manajemen meja restoran berbasis web: panggilan pelanggan otomatis lewat soundboard, status meja KOSONG/TERISI yang tersinkron real-time, pemesanan mandiri pelanggan via QR di meja, serta dashboard monitoring untuk Manager dan Owner.",
  },
  {
    q: "Bagaimana cara login sebagai crew?",
    a: "Masukkan Kode Resto yang diberikan administrator restoran pada dialog yang muncul saat pertama membuka aplikasi. Setelah kode valid, pilih peran Anda: SS (soundboard), Kasir, Satgas, atau Clear Up.",
  },
  {
    q: "Bagaimana Manager masuk ke dashboard?",
    a: "Manager masuk melalui halaman login Manager khusus memakai ID Manager dan password. Akun Manager dibuat lewat halaman registrasi Manager dengan mencantumkan kode restoran, ID Manager, nama lengkap, dan password.",
  },
  {
    q: "Kenapa audio tidak keluar suara saat pertama dibuka?",
    a: "Browser membatasi pemutaran audio otomatis. Aplikasi akan meminta izin lewat interaksi pertama (tombol LANJUT!!) untuk membuka akses audio. Jika masih terkunci, gunakan tombol Aktifkan Suara yang tersedia.",
  },
  {
    q: "Apakah audio bisa dipakai tanpa koneksi internet?",
    a: "Audio yang sudah tersinkron akan tersimpan di cache browser sehingga tetap bisa diputar meski koneksi sempat terputus. Sinkronisasi awal tetap membutuhkan koneksi internet.",
  },
  {
    q: "Bagaimana status meja bisa berubah otomatis?",
    a: "Ada dua jalur: pelanggan mengonfirmasi duduk lewat QR di meja (otomatis tercatat sebagai pindai QR), atau crew menandai langsung dari dashboard perannya — Kasir untuk pembayaran di kasir, Satgas untuk tamu yang diantar, dan Clear Up setelah meja dibersihkan. Semua perubahan langsung tersinkron real-time ke seluruh dashboard.",
  },
  {
    q: "Apa arti 'Perlu Dicek' di dashboard Manager?",
    a: "Label Perlu Dicek muncul pada meja yang sudah TERISI lebih dari 2 jam. Manager disarankan memeriksa kondisi meja tersebut, misalnya menanyakan ulang ke tamu atau memastikan crew sudah menangani meja itu.",
  },
  {
    q: "Apakah LIME bisa dipakai di HP?",
    a: "Ya. Seluruh dashboard crew dan stasiun SS dirancang mobile-first agar nyaman dipakai sambil berdiri. Dashboard Manager dan Kasir juga responsif bila dibuka di desktop atau PC.",
  },
  {
    q: "Apakah ada mode gelap?",
    a: "Ada. Tombol tema gelap/terang tersedia di header dan menu profil setiap dashboard. Pilihan tema tersimpan di perangkat sehingga tampilan konsisten saat aplikasi dibuka kembali.",
  },
  {
    q: "Apakah data restoran saya aman?",
    a: "Setiap restoran memiliki data, katalog audio, dan sesi yang terpisah secara ketat per tenant. Akses crew diverifikasi lewat kode resto, sesi Manager divalidasi di server, dan login Owner dibatasi percobaan untuk mencegah penyalahgunaan.",
  },
  {
    q: "Apakah audio yang digunakan memiliki lisensi?",
    a: "Ya. Semua audio di stasiun SS menggunakan lisensi Pro / Commercial Use. Audio dihasilkan melalui aplikasi pihak ketiga, yaitu ElevenLabs (elevenlabs.io), sehingga aman digunakan untuk operasional komersial restoran.",
  },
  {
    q: "Siapa pengembang LIME?",
    a: "LIME dikembangkan oleh XDIRGA LABS (Simplify Your Mind), sebuah tim pengembang yang berlokasi di Bekasi, Indonesia. Kami menggunakan pendekatan low-code untuk efisiensi pengerjaan proyek berbagai skala. Untuk kebutuhan aplikasi custom, silakan kunjungi halaman Kontak.",
  },
];

function FaqPage() {
  const logout = useCrewLogout();
  return (
    <ThemeFrame>
      <div className="pb-10">
        <Header onLogout={logout} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">Pertanyaan Umum</h1>
            <p className="mt-3 text-sm leading-relaxed text-ta-gray-500 sm:text-base dark:text-ta-gray-400">
              Jawaban singkat untuk pertanyaan yang paling sering muncul seputar LIME.
            </p>

            <div className="mt-8 space-y-3">
              {faqs.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900"
                >
                  <summary className="cursor-pointer list-none text-sm font-bold leading-snug marker:content-none sm:text-base">
                    <span className="mr-2 text-brand-500">Q.</span>
                    {q}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-ta-gray-500 dark:text-ta-gray-400">
                    {a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeFrame>
  );
}
