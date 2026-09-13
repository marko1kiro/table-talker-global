import type { ReactNode } from "react";
import { Table2, Users, ScrollText, BarChart3, MessageSquare, KeyRound } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import { Footer } from "@/components/Footer";

export type ManagerMenu = "tables" | "otp" | "crew" | "log" | "stats" | "messages";

const ICONS = {
  tables: Table2,
  otp: KeyRound,
  crew: Users,
  log: ScrollText,
  stats: BarChart3,
  messages: MessageSquare,
} as const;
const LABELS: { id: ManagerMenu; label: string }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE" },
  { id: "otp", label: "OTP CREW" },
  { id: "crew", label: "LIHAT CREW AKTIF" },
  { id: "messages", label: "KIRIM INSTRUKSI" },
  { id: "stats", label: "STATISTIK" },
  { id: "log", label: "LOG AKTIVITAS CREW" },
];

function Brand() {
  return (
    <>
      {/* Mobile header has no room for the wordmark: the profile cluster
          shared with it pushed the page sideways. Logo on mobile, the RGB
          DASHBOARD text from md up. */}
      <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none md:hidden" />
      <span className="hidden bg-gradient-to-r from-red-500 via-green-500 to-blue-500 bg-clip-text text-lg font-black uppercase tracking-[0.25em] text-transparent md:inline">
        DASHBOARD
      </span>
    </>
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
      brand={<img src="/lime-logo.webp" alt="LIME" className="h-8 w-auto shrink-0 select-none" />}
      navItems={navItems}
      headerLogo={<Brand />}
      headerRight={headerRight}
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      {children}
    </AppShell>
  );
}
