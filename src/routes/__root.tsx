import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ta-gray-50 px-4 dark:bg-ta-gray-900">
      <div className="max-w-md rounded-2xl border border-ta-gray-200 bg-white p-8 text-center shadow-theme-sm dark:border-ta-gray-700 dark:bg-ta-gray-800">
        <h1 className="text-7xl font-black text-ta-gray-900 dark:text-white">404</h1>
        <h2 className="mt-4 text-xl font-bold text-ta-gray-900 dark:text-white">
          Halaman tidak ada
        </h2>
        <p className="mt-2 text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Halaman yang kamu cari tidak ditemukan.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
          >
            Kembali
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-ta-gray-50 px-4 dark:bg-ta-gray-900">
      <div className="max-w-md rounded-2xl border border-ta-gray-200 bg-white p-8 text-center shadow-theme-sm dark:border-ta-gray-700 dark:bg-ta-gray-800">
        <h1 className="text-xl font-bold text-ta-gray-900 dark:text-white">Halaman gagal dimuat</h1>
        <p className="mt-2 text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Ada yang error. Coba refresh atau kembali ke beranda.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
          >
            Coba lagi
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-ta-gray-200 bg-white px-4 py-2 text-sm font-bold text-ta-gray-900 transition hover:bg-ta-gray-50 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-white dark:hover:bg-ta-gray-700"
          >
            Beranda
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "LIME — Sistem Panggilan & Status Meja Restoran" },
      {
        name: "description",
        content:
          "LIME membantu operasional restoran: panggil pelanggan lewat nomor meja, pantau status meja terisi/kosong secara realtime, catat aktivitas crew per station, dan dashboard monitoring untuk manager. Multi-cabang, aman, tanpa instalasi.",
      },
      { name: "application-name", content: "LIME" },
      { name: "author", content: "XDIRGA LABS" },
      {
        name: "keywords",
        content:
          "panggilan meja restoran, status meja realtime, sistem okupansi meja, dashboard manager restoran, crew kasir satgas clear up, QR meja, lihatmeja",
      },
      { name: "theme-color", content: "#f5f2e8" },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "LIME" },
      { property: "og:locale", content: "id_ID" },
      { property: "og:url", content: "https://tes.lihatmeja.com/" },
      { property: "og:title", content: "LIME — Sistem Panggilan & Status Meja Restoran" },
      {
        property: "og:description",
        content:
          "Panggil pelanggan lewat nomor meja, pantau status terisi/kosong realtime, dan monitor operasional lewat dashboard manager. Satu platform untuk seluruh station restoran.",
      },
      { property: "og:image", content: "https://tes.lihatmeja.com/lime-logo.webp" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "LIME — Sistem Panggilan & Status Meja Restoran" },
      {
        name: "twitter:description",
        content:
          "Panggil pelanggan lewat nomor meja, pantau status terisi/kosong realtime, dan monitor operasional lewat dashboard manager.",
      },
      { name: "twitter:image", content: "https://tes.lihatmeja.com/lime-logo.webp" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&family=Outfit:wght@100..900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
