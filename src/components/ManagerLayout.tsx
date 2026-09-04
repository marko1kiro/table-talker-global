import { useState, type ReactNode } from "react";
import { Menu, Table2, Users, ScrollText, X } from "lucide-react";

export type ManagerMenu = "tables" | "crew" | "log";

const MENU: { id: ManagerMenu; label: string; icon: typeof Table2 }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE", icon: Table2 },
  { id: "crew", label: "LIHAT CREW AKTIF", icon: Users },
  { id: "log", label: "LOG AKTIVITAS CREW", icon: ScrollText },
];

function RailTitle() {
  return (
    <span className="bg-gradient-to-r from-red-500 via-green-500 to-blue-500 bg-clip-text text-lg font-black uppercase tracking-[0.25em] text-transparent">
      DASHBOARD
    </span>
  );
}

function NavList({
  active,
  onSelect,
  activeClass = "bg-cyan-500 text-white shadow-sm",
}: {
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
  activeClass?: string;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {MENU.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
            active === id ? activeClass : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function FooterBranding({ restaurantName }: { restaurantName: string }) {
  return (
    <>
      <p className="text-sm font-extrabold uppercase text-slate-900">{restaurantName}</p>
      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-slate-400">
        lihatmeja.com <span aria-label="copyright">©</span> 2026
      </p>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">XDIRGA LABS</p>
    </>
  );
}

export function ManagerLayout({
  restaurantName,
  active,
  onSelect,
  header,
  children,
}: {
  restaurantName: string;
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pick = (m: ManagerMenu) => {
    onSelect(m);
    setOpen(false);
  };
  return (
    <div className="min-h-[100svh] bg-slate-50 text-slate-950">
      <div className="md:flex">
        <button
          type="button"
          aria-label="Buka menu"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 flex size-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg md:hidden"
        >
          <Menu className="size-6" />
        </button>

        {open && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <RailTitle />
                <button type="button" aria-label="Tutup" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </button>
              </div>
              <NavList active={active} onSelect={pick} />
            </div>
          </div>
        )}

        <aside className="hidden md:flex md:sticky md:top-0 md:h-[100svh] w-72 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4">
          <div className="mb-6 flex h-14 items-center justify-center">
            <RailTitle />
          </div>
          <NavList active={active} onSelect={pick} />
          <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <FooterBranding restaurantName={restaurantName} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {header}
          <div className="w-full px-4 py-5 sm:px-6">{children}</div>
          <footer className="px-4 pb-8 pt-2 text-center md:hidden">
            <FooterBranding restaurantName={restaurantName} />
          </footer>
        </main>
      </div>
    </div>
  );
}
