import { createFileRoute } from "@tanstack/react-router";
import { Volume2, Radio, QrCode, Users, LayoutDashboard, ShieldCheck } from "lucide-react";

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
          "LIME adalah sistem manajemen meja restoran: panggilan meja otomatis, status meja real-time, pemesanan mandiri via QR, serta monitoring Manager, Area Manager, dan Super Admin. Kenali cara kerja dan tujuan aplikasi ini.",
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
    title: "Panggilan Meja Otomatis",
    body: "Crew cukup menekan nomor meja di stasiun SS dan LIME memutar rekaman panggilan secara otomatis, lengkap dengan katalog pengumuman umum, info, dan larangan. Tidak perlu lagi crew berteriak manual di area dapur atau kasir.",
  },
  {
    icon: Radio,
    title: "Status Meja Real-Time",
    body: "Status KOSONG dan TERISI tersinkron langsung lintas peran: Kasir, Satgas, Clear Up, hingga dashboard Manager. Setiap perubahan langsung terlihat di seluruh dashboard tanpa perlu memuat ulang halaman.",
  },
  {
    icon: QrCode,
    title: "Pemesanan Mandiri via QR",
    body: "Pelanggan memindai QR yang tersedia di meja untuk konfirmasi duduk, dan meja otomatis tercatat TERISI. Bila pelanggan membatalkan konfirmasi, meja kembali tersedia setelah masa tunggu singkat.",
  },
  {
    icon: Users,
    title: "Peran Operasional Terpisah",
    body: "Setiap peran memiliki dashboard khusus yang mobile-first: Kasir menandai meja untuk pelanggan yang membayar langsung di kasir, Satgas mengantar dan mengonfirmasi tamu yang sudah duduk, Clear Up menandai meja selesai dibersihkan, dan SS memutar panggilan.",
  },
  {
    icon: LayoutDashboard,
    title: "Monitoring Manager",
    body: "Manager memantau grid 100 meja beserta statistik Terisi, Kosong, dan Perlu Dicek (meja terisi lebih dari 2 jam), dilengkapi pusat notifikasi perubahan status, log aktivitas crew, serta mode gelap.",
  },
  {
    icon: ShieldCheck,
    title: "Konsol Super Admin yang Lengkap",
    body: "Pemilik restoran mengelola data restoran, akun manager, katalog audio, ekspor QR, riwayat aktivitas, dan log kesalahan operasional dari satu konsol Super Admin yang aman dan terlindungi kredensial.",
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
              LIME adalah sistem manajemen meja restoran yang mencakup panggilan pelanggan otomatis
              lewat soundboard, status meja real-time lintas peran, pemesanan mandiri via QR, serta
              dashboard monitoring untuk Manager, Area Manager, dan Super Admin. Tujuannya:
              operasional dapur, kasir, dan lantai layanan menjadi lebih cepat, rapi, dan konsisten.
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

            <div className="mt-8 rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-5 dark:border-ta-gray-700 dark:bg-ta-gray-900">
              <h2 className="text-base font-bold text-ta-gray-900 dark:text-white">Pengembang</h2>
              <p className="mt-2 text-sm leading-relaxed text-ta-gray-500 dark:text-ta-gray-400">
                LIME dikembangkan oleh{" "}
                <span className="font-semibold text-ta-gray-700 dark:text-ta-gray-200">
                  XDIRGA LABS
                </span>{" "}
                — <em>Simplify Your Mind</em>. Berlokasi di Bekasi, Indonesia, kami membangun
                aplikasi ini dengan pendekatan{" "}
                <span className="font-semibold text-ta-gray-700 dark:text-ta-gray-200">
                  low-code
                </span>{" "}
                untuk efisiensi pengerjaan berbagai skala proyek. Butuh aplikasi custom untuk bisnis
                Anda?{" "}
                <a href="/contact" className="font-semibold text-brand-500 hover:underline">
                  Hubungi kami
                </a>
                .
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeFrame>
  );
}
