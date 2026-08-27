import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin, logout } from "@/lib/auth";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const nav = [
  ["Dashboard", "/super-admin"],
  ["Resto", "/super-admin/restaurants"],
  ["Audio", "/super-admin/audio"],
  ["Riwayat", "/super-admin/history"],
  ["Error Log", "/super-admin/error-log"],
  ["Broadcast", "/super-admin/broadcast"],
] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Owner Console - Table Talker" }, { name: "robots", content: "noindex" }],
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
    <main className="min-h-[100svh] bg-background text-foreground">
      <button
        type="button"
        aria-label="Buka navigasi owner"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
        className="brutal-border brutal-press fixed left-4 top-4 z-20 bg-accent p-2 md:hidden"
      >
        <Menu className="size-5" />
      </button>
      <aside className="brutal-border fixed inset-y-0 left-0 z-30 hidden w-64 bg-card p-4 md:block">
        <Navigation onNavigate={() => setMenuOpen(false)} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="brutal-border w-72 bg-card p-4 md:hidden">
          <SheetTitle className="sr-only">Navigasi owner</SheetTitle>
          <div className="pt-6">
            <Navigation onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <section className="mx-auto max-w-7xl p-4 pt-20 md:ml-64 md:p-8">
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
    <nav aria-label="Navigasi owner">
      <p className="font-display text-xl uppercase">Table Talker</p>
      <p className="mt-1 text-xs font-bold uppercase text-muted-foreground">Owner Console</p>
      <div className="mt-8 grid gap-2">
        {nav.map(([label, to]) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            activeProps={{ className: "bg-accent" }}
            className="brutal-border brutal-press px-3 py-2 font-display uppercase"
          >
            {label}
          </Link>
        ))}
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="brutal-border brutal-press mt-8 w-full px-3 py-2 font-display uppercase"
      >
        {loggingOut ? "Keluar..." : "Keluar"}
      </button>
      {logoutError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {logoutError}
        </p>
      )}
    </nav>
  );
}
