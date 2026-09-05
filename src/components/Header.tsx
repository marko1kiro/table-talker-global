import { Link } from "@tanstack/react-router";
import { LifeBuoy, LogOut } from "lucide-react";
import { RoleEmblem } from "@/components/dashboard/RoleEmblem";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { ProfileMenu } from "@/components/dashboard/ProfileMenu";

interface HeaderProps {
  readyCount: number;
  totalCount: number;
  restaurantDisplayName?: string;
  userName?: string;
  // Public info pages render this Header without an active crew/role session,
  // so the sign-out affordance is optional and only wired when a handler exists.
  onLogout?: () => void;
}

// SS station header, TailAdmin-styled (de-brutalized in SP3). Shared by the SS
// station and the public info pages. Mobile-first, full-width sticky bar:
// logo + "SS" emblem + resto label on the left; ready count + help + theme
// toggle + profile/logout on the right. No notification bell (SS has no live
// occupancy feed).
export function Header({
  readyCount,
  totalCount,
  restaurantDisplayName,
  userName,
  onLogout,
}: HeaderProps) {
  const restoLabel = restaurantDisplayName?.trim() || "Restoran";
  return (
    <header className="sticky top-0 z-40 border-b border-ta-gray-200 bg-white/95 backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="flex shrink-0 items-center">
            <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
          </Link>
          <RoleEmblem label="SS" />
          <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-ta-gray-500 sm:text-sm dark:text-ta-gray-400">
            {restoLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {totalCount > 0 && (
            <span className="rounded-full bg-ta-gray-100 px-2.5 py-1 text-xs font-bold text-ta-gray-600 dark:bg-ta-gray-700 dark:text-ta-gray-300">
              Siap {readyCount}/{totalCount}
            </span>
          )}
          <Link
            to="/help"
            aria-label="Butuh bantuan?"
            className="grid size-9 place-items-center rounded-lg text-ta-gray-500 transition hover:bg-ta-gray-100 hover:text-brand-500 dark:text-ta-gray-400 dark:hover:bg-ta-gray-700"
          >
            <LifeBuoy className="size-5" />
          </Link>
          <ThemeToggle />
          {userName ? (
            <ProfileMenu
              name={userName}
              canChangePassword={false}
              onLogout={onLogout ?? (() => {})}
            />
          ) : (
            onLogout && (
              <button
                type="button"
                onClick={onLogout}
                aria-label="Keluar"
                title="Keluar"
                className="grid size-9 place-items-center rounded-lg border border-ta-gray-200 text-ta-error transition hover:bg-ta-error/10 dark:border-ta-gray-700"
              >
                <LogOut className="size-5" />
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
