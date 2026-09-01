import type { ReactNode } from "react";

// Dedicated header for the crew dashboards (Kasir, Satgas, Clear Up).
// Plain shadcn-style look (rounded card, border, shadow-sm) -- intentionally
// does NOT reuse the SS station's neo-brutalist Header. Carries the LIME
// (Liat Meja) brand mark plus the restaurant identity and role context in a
// clearer, better organized layout than the previous single-row
// OwnerPageHeader used to render for these routes.
export function CrewHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/lime-logo.webp"
            alt="LIME"
            className="h-7 w-auto shrink-0 select-none sm:h-8"
          />
          {eyebrow && (
            <>
              <span
                aria-hidden="true"
                className="hidden h-6 w-px shrink-0 bg-slate-200 sm:block"
              />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase leading-none tracking-wider text-slate-400">
                  Resto
                </p>
                <p className="mt-0.5 max-w-[55vw] truncate text-sm font-extrabold text-slate-900 sm:max-w-xs">
                  {eyebrow}
                </p>
              </div>
            </>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className="px-5 py-4 sm:px-6">
        <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
          {title}
        </span>
        {description && (
          <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-[15px]">{description}</p>
        )}
      </div>
    </header>
  );
}
