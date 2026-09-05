import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OccupancyNotice } from "@/lib/occupancy-notice";
import { ThemeContext, useTheme } from "./use-theme";

export type AppShellNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
};

function Nav({ items, onNavigate }: { items: AppShellNavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ id, label, icon: Icon, active, onSelect }) => (
        <button
          key={id}
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => {
            onSelect();
            onNavigate?.();
          }}
          className={cn(
            "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            active
              ? "bg-brand-50 text-brand-500 dark:bg-brand-500/10 dark:text-brand-400"
              : "text-ta-gray-700 hover:bg-ta-gray-100 dark:text-ta-gray-300 dark:hover:bg-ta-gray-800",
          )}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function AppShell({
  brand,
  navItems,
  headerTitle,
  headerLogo,
  headerRight,
  notice,
  footer,
  children,
}: {
  brand: ReactNode;
  navItems: AppShellNavItem[];
  headerTitle: string;
  headerLogo?: ReactNode;
  headerRight?: ReactNode;
  notice?: OccupancyNotice | null;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <div
        className={cn(
          "min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900 dark:bg-ta-gray-900 dark:text-ta-gray-100",
          theme.isDark && "dark",
        )}
      >
        <div className="md:flex">
          <button
            type="button"
            aria-label="Buka menu"
            onClick={() => setOpen(true)}
            className="fixed bottom-4 left-4 z-40 flex size-12 items-center justify-center rounded-full bg-brand-500 text-white shadow-theme-md md:hidden"
          >
            <Menu className="size-6" />
          </button>

          {open && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                aria-label="Tutup menu"
                className="absolute inset-0 bg-ta-gray-900/40"
                onClick={() => setOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white p-4 shadow-theme-md dark:bg-ta-gray-800">
                <div className="mb-6 flex items-center justify-between">
                  {brand}
                  <button type="button" aria-label="Tutup" onClick={() => setOpen(false)}>
                    <X className="size-5 text-ta-gray-500 dark:text-ta-gray-400" />
                  </button>
                </div>
                <Nav items={navItems} onNavigate={() => setOpen(false)} />
                {footer && <div className="mt-auto pt-4">{footer}</div>}
              </div>
            </div>
          )}

          <aside className="hidden md:flex md:sticky md:top-0 md:h-[100svh] w-64 shrink-0 flex-col overflow-y-auto border-r border-ta-gray-200 bg-white p-4 dark:border-ta-gray-700 dark:bg-ta-gray-800">
            <div className="mb-6 flex h-14 items-center justify-center">{brand}</div>
            <Nav items={navItems} />
            {footer && <div className="mt-auto pt-4">{footer}</div>}
          </aside>

          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ta-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 dark:border-ta-gray-700 dark:bg-ta-gray-800/95">
              {headerLogo ? (
                <>
                  <div className="flex md:hidden">{headerLogo}</div>
                  <h1 className="hidden truncate text-base font-semibold text-ta-gray-900 md:block dark:text-white">
                    {headerTitle}
                  </h1>
                </>
              ) : (
                <h1 className="truncate text-base font-semibold text-ta-gray-900 dark:text-white">
                  {headerTitle}
                </h1>
              )}
              <div className="flex shrink-0 items-center gap-2">{headerRight}</div>
            </header>

            {notice && (
              <div className="border-b border-brand-100 bg-brand-50 px-4 py-2 sm:px-6 md:hidden dark:border-ta-gray-700 dark:bg-brand-500/10">
                <p className="truncate text-sm font-semibold uppercase text-brand-700 dark:text-brand-300">
                  {notice.line1}
                  <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {notice.roleLabel}
                  </span>
                </p>
              </div>
            )}

            <div className="w-full px-4 py-5 sm:px-6">{children}</div>
          </main>
        </div>
      </div>
    </ThemeContext.Provider>
  );
}
