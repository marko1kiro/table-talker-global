import { useState } from "react";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin } from "@/lib/auth";
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
    </nav>
  );
}
