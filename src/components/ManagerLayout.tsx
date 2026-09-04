import type { ReactNode } from "react";
import { Table2, Users, ScrollText } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export type ManagerMenu = "tables" | "crew" | "log";

const ICONS = { tables: Table2, crew: Users, log: ScrollText } as const;
const LABELS: { id: ManagerMenu; label: string }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE" },
  { id: "crew", label: "LIHAT CREW AKTIF" },
  { id: "log", label: "LOG AKTIVITAS CREW" },
];

function Brand() {
  return (
    <span className="bg-gradient-to-r from-red-500 via-green-500 to-blue-500 bg-clip-text text-lg font-black uppercase tracking-[0.25em] text-transparent">
      DASHBOARD
    </span>
  );
}

export function ManagerLayout({
  restaurantName,
  active,
  onSelect,
  notice,
  headerRight,
  children,
}: {
  restaurantName: string;
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
  notice?: OccupancyNotice | null;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const navItems: AppShellNavItem[] = LABELS.map(({ id, label }) => ({
    id,
    label,
    icon: ICONS[id],
    active: active === id,
    onSelect: () => onSelect(id),
  }));
  const headerTitle = LABELS.find((l) => l.id === active)?.label ?? "Dashboard";
  const footer = (
    <div className="rounded-xl border border-ta-gray-200 bg-white p-4 text-center">
      <p className="truncate whitespace-nowrap text-[13px] font-bold uppercase text-ta-gray-900 dark:text-white">
        {restaurantName}
      </p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-ta-gray-400">
        lihatmeja.com <span aria-label="copyright">©</span> 2026
      </p>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ta-gray-400">XDIRGA LABS</p>
    </div>
  );
  return (
    <AppShell
      brand={<Brand />}
      navItems={navItems}
      headerTitle={headerTitle}
      headerRight={headerRight}
      notice={notice}
      footer={footer}
    >
      {children}
    </AppShell>
  );
}
