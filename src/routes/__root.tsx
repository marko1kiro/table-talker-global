import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

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
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

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
      { title: "LIME — Panggilan Meja Restoran" },
      {
        name: "description",
        content:
          "Soundboard panggilan meja untuk restoran. Tap nomor meja, suara panggilan otomatis diputar.",
      },
      { name: "theme-color", content: "#f5f2e8" },
      { property: "og:title", content: "LIME — Panggilan Meja Restoran" },
      {
        property: "og:description",
        content:
          "Soundboard panggilan meja untuk restoran. Tap nomor meja, suara panggilan otomatis diputar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&display=swap",
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
