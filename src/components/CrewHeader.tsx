import type { ReactNode } from "react";
import { LayoutGrid, List, LogOut } from "lucide-react";

// Dedicated header for the crew dashboards (Kasir, Satgas, Clear Up).
// Plain shadcn-style look (rounded card, border, shadow-sm) -- intentionally
// does NOT reuse the SS station's neo-brutalist Header. Sticky so crew
// never loses the resto/user/role context while scrolling.
//
// The "Daftar Nomor Meja" title + list/grid switch + status legend live in a
// separate CrewTableSection card right below the header (not merged into it),
// wrapping whichever table content (loading / error / grid / list) is passed
// as children.

const LEGEND_DOT_CLASS: Record<"emerald" | "amber" | "red", string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function CrewHeader({
  role,
  restaurantName,
  userName,
  onLogout,
}: {
  role: string;
  restaurantName?: string;
  userName: string;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/lime-logo.webp"
            alt="LIME"
            className="h-7 w-auto shrink-0 select-none sm:h-8"
          />
          <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            {role}
          </span>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span className="max-w-[7rem] truncate text-xs font-bold uppercase text-slate-600 sm:max-w-[12rem] sm:text-sm">
            {userName}
          </span>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Keluar"
            title="Keluar"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      {restaurantName && (
        <div className="border-t border-slate-100 px-5 py-2.5 sm:px-6">
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-lg bg-lime-50 px-2.5 py-1 text-sm font-extrabold text-lime-800 ring-1 ring-inset ring-lime-200">
            {restaurantName}
          </span>
        </div>
      )}
    </header>
  );
}

export function CrewTableSection({
  legend,
  layoutPreference,
  onToggleLayout,
  children,
}: {
  legend: { color: "emerald" | "amber" | "red"; label: string }[];
  layoutPreference: "grid" | "list";
  onToggleLayout: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900 sm:text-lg">
            Daftar Nomor Meja
          </h2>
          <button
            type="button"
            onClick={onToggleLayout}
            aria-label={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            title={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:size-11"
          >
            {layoutPreference === "grid" ? (
              <List className="size-5 sm:size-6" />
            ) : (
              <LayoutGrid className="size-5 sm:size-6" />
            )}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"
            >
              <span className={`size-2 rounded-full ${LEGEND_DOT_CLASS[item.color]}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
