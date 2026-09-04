import type { ReactNode } from "react";
import { LayoutGrid, List, LogOut } from "lucide-react";
import { formatRestaurantLabel } from "../lib/restaurant-label";
import type { OccupancyNotice } from "../lib/occupancy-notice";

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

// Shared crew button tokens: the plain, light crew look (rounded-xl, soft
// slate borders, thumb-friendly min height) used by crew confirmation
// dialogs. Not the Super Admin (owner) styles -- see
// docs/superpowers/specs/2026-09-03-crew-dialog-restyle-design.md.
export const crewPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/15 disabled:pointer-events-none disabled:opacity-45";

export const crewSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:pointer-events-none disabled:opacity-45";

export function CrewHeader({
  role,
  restaurantName,
  restaurantCode,
  userName,
  onLogout,
  notice,
}: {
  role: string;
  restaurantName?: string;
  restaurantCode?: string;
  userName: string;
  onLogout: () => void;
  notice?: OccupancyNotice | null;
}) {
  const label = formatRestaurantLabel(restaurantCode ?? "", restaurantName ?? "");
  return (
    <header className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="flex items-center justify-between gap-3 px-5 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/lime-logo.webp"
            alt="LIME"
            className="h-6 w-auto shrink-0 select-none sm:h-7"
          />
          <span className="min-w-0 truncate text-[11px] font-extrabold uppercase tracking-wide text-lime-800 sm:text-xs">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end">
            <span className="max-w-[7rem] truncate text-xs font-bold uppercase text-slate-600 sm:max-w-[12rem]">
              {userName}
            </span>
            <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white sm:text-[10px]">
              {role}
            </span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Keluar"
            title="Keluar"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-red-600 bg-red-600 text-white transition hover:border-red-700 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pb-2 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-col justify-center rounded-xl bg-fuchsia-50 px-3 py-1.5 ring-1 ring-inset ring-fuchsia-200">
          {notice ? (
            <>
              <p className="truncate text-sm font-extrabold uppercase text-fuchsia-900">
                {notice.line1}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-fuchsia-800">
                <span className="text-[10px] font-bold uppercase text-fuchsia-500">BY</span>
                <span className="inline-flex items-center rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {notice.roleLabel}
                </span>
                {notice.actorName ? <span>: {notice.actorName}</span> : null}
              </p>
            </>
          ) : (
            <p className="text-center text-xs font-semibold text-fuchsia-400">
              Informasi Update Status Meja Akan Muncul Disini Ya.
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

export function CrewTableSection({
  legend,
  layoutPreference,
  onToggleLayout,
  desktopHint,
  children,
}: {
  legend: { color: "emerald" | "amber" | "red"; label: string }[];
  layoutPreference: "grid" | "list";
  onToggleLayout: () => void;
  // Optional explanatory text rendered next to the title, desktop only
  // (hidden below the `lg` breakpoint). Currently only used by Kasir.
  desktopHint?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="shrink-0 text-base font-extrabold uppercase tracking-wide text-slate-900 sm:text-lg">
              Daftar Nomor Meja
            </h2>
            {desktopHint && (
              <span className="hidden truncate text-xs font-medium normal-case tracking-normal text-slate-500 lg:inline">
                {desktopHint}
              </span>
            )}
          </div>
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
