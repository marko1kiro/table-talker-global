import { useState, type ReactNode } from "react";
import { Menu, Table2, Users, ScrollText, X } from "lucide-react";

export type ManagerMenu = "tables" | "crew" | "log";

const MENU: { id: ManagerMenu; label: string; icon: typeof Table2 }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE", icon: Table2 },
  { id: "crew", label: "LIHAT CREW AKTIF", icon: Users },
  { id: "log", label: "LOG AKTIVITAS CREW", icon: ScrollText },
];

function NavList({
  active,
  onSelect,
}: {
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
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
            active === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ManagerLayout({
  restaurantCode,
  restaurantName,
  active,
  onSelect,
  header,
  children,
}: {
  restaurantCode: string;
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
                <span className="text-sm font-black uppercase">Manager</span>
                <button type="button" aria-label="Tutup" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </button>
              </div>
              <NavList active={active} onSelect={pick} />
            </div>
          </div>
        )}

        <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
          <p className="mb-4 px-3 text-sm font-black uppercase tracking-wide text-slate-900">
            Dashboard Manager
          </p>
          <NavList active={active} onSelect={pick} />
          <div className="mt-auto border-t border-slate-100 pt-4 text-center">
            <p className="text-sm font-extrabold uppercase text-slate-900">
              MIE GACOAN {restaurantCode}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{restaurantName}</p>
            <p className="mt-2 text-[11px] text-slate-400">lihatmeja.com (c)2026</p>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              XDIRGA LABS
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {header}
          <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">{children}</div>
          <footer className="px-4 pb-8 pt-2 text-center text-[11px] text-slate-400 md:hidden">
            <p className="font-extrabold uppercase text-slate-600">MIE GACOAN {restaurantCode}</p>
            <p>lihatmeja.com (c)2026 · XDIRGA LABS</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
