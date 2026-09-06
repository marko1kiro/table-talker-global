import type { ReactNode } from "react";
import { Table2, Users, ScrollText } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import { Footer } from "@/components/Footer";

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
  headerRight,
  children,
}: {
  restaurantName: string;
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
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
  return (
    <AppShell
      brand={<Brand />}
      navItems={navItems}
      headerLogo={
        <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
      }
      headerRight={headerRight}
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      {children}
    </AppShell>
  );
}
