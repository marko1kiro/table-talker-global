import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Table2,
  Trophy,
  Users,
  KeyRound,
} from "lucide-react";
import { AppShell } from "@/components/dashboard/AppShell";
import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";
import { Footer } from "@/components/Footer";

export const AM_NAV = [
  { to: "/am", label: "Dashboard", icon: LayoutDashboard },
  { to: "/am/meja", label: "Status Meja", icon: Table2 },
  { to: "/am/statistik", label: "Statistik", icon: BarChart3 },
  { to: "/am/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/am/manager", label: "Manager Resto", icon: Users },
  { to: "/am/password", label: "Password Request", icon: KeyRound },
  { to: "/am/audit", label: "Audit Trail", icon: ScrollText },
] as const;

export function AmLayout({
  active,
  fullName,
  staffId,
  onLogout,
  onChangePassword,
  onEditProfile,
  children,
}: {
  active: string;
  fullName: string;
  staffId?: string;
  onLogout: () => void;
  onChangePassword: () => void;
  onEditProfile: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <AppShell
      brand={
        <div className="flex items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0" />
          <span className="flex items-center gap-1 text-sm font-bold text-ta-gray-900">
            <ShieldCheck className="size-4 text-brand-500" /> Area Manager
          </span>
        </div>
      }
      navItems={AM_NAV.map((n) => ({
        id: n.to,
        label: n.label,
        icon: n.icon,
        active: active === n.to,
        onSelect: () => {
          if (active !== n.to) void navigate({ to: n.to });
        },
      }))}
      headerTitle="Area Manager"
      headerRight={
        <DashboardHeaderRight
          roleLabel="AREA MANAGER"
          profile={{ name: fullName, idManager: staffId, canChangePassword: true }}
          onLogout={onLogout}
          onChangePassword={onChangePassword}
          onEditProfile={onEditProfile}
        />
      }
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      {children}
    </AppShell>
  );
}
