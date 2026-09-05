import type { ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";

// Crew table section card + shared crew button tokens. The old `CrewHeader`
// component was replaced by the global `CrewShell` (SP2); this file now only
// provides the "Daftar Nomor Meja" section wrapper (title + list/grid switch +
// status legend) and the crew dialog button styles.

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
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/15 disabled:pointer-events-none disabled:opacity-45 dark:bg-ta-gray-100 dark:text-ta-gray-900 dark:hover:bg-white";

export const crewSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:pointer-events-none disabled:opacity-45 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-200 dark:hover:border-ta-gray-600 dark:hover:bg-ta-gray-700";

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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-ta-gray-700 dark:bg-ta-gray-800">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6 dark:border-ta-gray-700">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="shrink-0 text-base font-extrabold uppercase tracking-wide text-slate-900 sm:text-lg dark:text-white">
              Daftar Nomor Meja
            </h2>
            {desktopHint && (
              <span className="hidden truncate text-xs font-medium normal-case tracking-normal text-slate-500 lg:inline dark:text-ta-gray-400">
                {desktopHint}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleLayout}
            aria-label={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            title={layoutPreference === "grid" ? "Tampilan List" : "Tampilan Grid"}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:size-11 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:border-ta-gray-600 dark:hover:bg-ta-gray-700"
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
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-ta-gray-400"
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
