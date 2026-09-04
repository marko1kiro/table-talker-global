import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import {
  AudioLines,
  Building2,
  ChevronRight,
  CircleGauge,
  History,
  LogOut,
  Menu,
  QrCode,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin, logout } from "@/lib/auth";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const nav = [
  { label: "Dashboard", to: "/super-admin", icon: CircleGauge, exact: true },
  { label: "Restoran", to: "/super-admin/restaurants", icon: Building2, exact: false },
  { label: "Manager", to: "/super-admin/managers", icon: Users, exact: false },
  { label: "Audio", to: "/super-admin/audio", icon: AudioLines, exact: false },
  { label: "Riwayat", to: "/super-admin/history", icon: History, exact: false },
  { label: "Error Log", to: "/super-admin/error-log", icon: TriangleAlert, exact: false },
  { label: "ESB & Export QR", to: "/super-admin/esb-export", icon: QrCode, exact: false },
] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Owner Console - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: OwnerShell,
});

function OwnerShell() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!auth?.superAdmin) {
    return (
      <AuthGate
        onSuccess={() => router.invalidate()}
        title="Login Owner"
        instruction="Masukkan password owner."
        submitLabel="Masuk"
        loginAction={loginSuperAdmin}
      />
    );
  }

  return (
    <main className="owner-console min-h-[100svh] bg-slate-50 text-slate-950">
      <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          aria-label="Buka navigasi owner"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
          <span className="text-sm font-black tracking-tight">LIME</span>
        </div>
        <span className="size-10" aria-hidden="true" />
      </header>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-slate-950 p-4 md:block">
        <Navigation onNavigate={() => setMenuOpen(false)} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="w-[19rem] border-0 bg-slate-950 p-4 text-white md:hidden"
        >
          <SheetTitle className="sr-only">Navigasi owner</SheetTitle>
          <Navigation onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <section className="mx-auto max-w-[96rem] px-4 pb-12 pt-24 sm:px-6 md:ml-72 md:px-8 md:pt-10 lg:px-10">
        <Outlet />
      </section>
    </main>
  );
}

function Navigation({ onNavigate }: { onNavigate: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mounted = useRef(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleLogout() {
    setLogoutError("");
    setLoggingOut(true);
    try {
      const result = await logout();
      if (!result.ok) {
        if (mounted.current) {
          setLogoutError("Logout gagal.");
          setLoggingOut(false);
        }
        return;
      }
      queryClient.removeQueries({ predicate: (query) => isOwnerQueryKey(query.queryKey) });
      onNavigate();
      if (mounted.current) setLoggingOut(false);
      await router.invalidate();
    } catch {
      if (!mounted.current) return;
      setLogoutError("Logout gagal.");
      setLoggingOut(false);
    }
  }

  return (
    <nav aria-label="Navigasi owner" className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-2 py-3">
        <img src="/lime-logo.webp" alt="LIME" className="h-8 w-auto shrink-0 select-none" />
        <div>
          <p className="text-base font-black tracking-tight text-white">LIME</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
            <ShieldCheck className="size-3" /> Owner Console
          </p>
        </div>
      </div>

      <div className="mt-7 space-y-1">
        <p className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
          Workspace
        </p>
        {nav.map(({ label, to, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            onClick={onNavigate}
            activeProps={{
              className: "bg-amber-400 text-slate-950 shadow-sm hover:bg-amber-400",
            }}
            inactiveProps={{ className: "text-slate-300 hover:bg-white/8 hover:text-white" }}
            className="group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition"
          >
            <Icon className="size-[18px]" />
            <span className="flex-1">{label}</span>
            <ChevronRight className="size-4 opacity-0 transition group-hover:opacity-60" />
          </Link>
        ))}
      </div>

      <div className="mt-auto border-t border-white/10 pt-4">
        <div className="mb-3 rounded-xl bg-white/5 px-3 py-3">
          <p className="text-xs font-bold text-white">Mode pemilik</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            Akses penuh ke operasional restoran.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
        >
          <LogOut className="size-[18px]" />
          {loggingOut ? "Keluar..." : "Keluar"}
        </button>
        {logoutError && (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300"
          >
            {logoutError}
          </p>
        )}
      </div>
    </nav>
  );
}
