import { LayoutGrid, List, LogOut } from "lucide-react";

// Dedicated header for the crew dashboards (Kasir, Satgas, Clear Up).
// Plain shadcn-style look (rounded card, border, shadow-sm) -- intentionally
// does NOT reuse the SS station's neo-brutalist Header. Sticky so crew
// never loses the resto/user/role context or the Meja section's
// title + list/grid switch + status legend while scrolling a long table
// grid on desktop.
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
  sectionTitle,
  hint,
  legend,
  layoutPreference,
  onToggleLayout,
}: {
  role: string;
  restaurantName?: string;
  userName: string;
  onLogout: () => void;
  sectionTitle: string;
  hint?: string;
  legend: { color: "emerald" | "amber" | "red"; label: string }[];
  layoutPreference: "grid" | "list";
  onToggleLayout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-6">
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

      <div className="px-5 pb-3 pt-3.5 sm:px-6">
        {restaurantName && (
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-lg bg-lime-50 px-2.5 py-1 text-sm font-extrabold text-lime-800 ring-1 ring-inset ring-lime-200">
            {restaurantName}
          </span>
        )}
        <p className="mt-1.5 truncate text-xs font-medium text-slate-500">
          Login sebagai <span className="font-bold text-slate-700">{userName}</span>
        </p>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-900">
              {sectionTitle}
            </h2>
            {hint && <p className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={onToggleLayout}
            aria-label={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            title={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {layoutPreference === "grid" ? (
              <List className="size-4" />
            ) : (
              <LayoutGrid className="size-4" />
            )}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
    </header>
  );
}
