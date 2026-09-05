import type { ReactNode } from "react";
import { ThemeFrame } from "./ThemeFrame";
import { DashboardHeaderRight } from "./DashboardHeaderRight";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function CrewShell({
  roleLabel,
  userName,
  onLogout,
  feed,
  unread,
  onOpen,
  children,
}: {
  roleLabel: string;
  userName: string;
  onLogout: () => void;
  feed: OccupancyNotice[];
  unread: number;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <ThemeFrame>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ta-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95">
        <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
        <DashboardHeaderRight
          roleLabel={roleLabel}
          profile={{ name: userName, canChangePassword: false }}
          notifications={{ stale: [], feed, unread, onOpen }}
          onLogout={onLogout}
        />
      </header>
      <main className="mx-auto w-full max-w-[720px] px-4 py-4">{children}</main>
    </ThemeFrame>
  );
}
