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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="brutal-border brutal-shadow-lg max-w-md bg-card p-8 text-center">
        <h1 className="text-7xl font-display text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-display uppercase text-foreground">Halaman tidak ada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman yang kamu cari tidak ditemukan.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="brutal-border brutal-shadow brutal-press inline-flex items-center justify-center bg-accent px-4 py-2 text-sm font-bold uppercase text-foreground"
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="brutal-border brutal-shadow-lg max-w-md bg-card p-8 text-center">
        <h1 className="text-xl font-display uppercase text-foreground">Halaman gagal dimuat</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ada yang error. Coba refresh atau kembali ke beranda.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="brutal-border brutal-shadow brutal-press inline-flex items-center justify-center bg-accent px-4 py-2 text-sm font-bold uppercase text-foreground"
          >
            Coba lagi
          </button>
          <a
            href="/"
            className="brutal-border brutal-shadow brutal-press inline-flex items-center justify-center bg-card px-4 py-2 text-sm font-bold uppercase text-foreground"
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
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
