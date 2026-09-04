/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Re-exported so super-admin pages can import the whole UI surface (incl. this
// pure date util) from one module after the OwnerUi -> dashboard/ui migration.
export { formatOwnerDate } from "@/components/OwnerUi";

export const taControlClass =
  "mt-1.5 min-h-11 w-full rounded-lg border border-ta-gray-300 bg-white px-3.5 py-2.5 text-sm text-ta-gray-900 outline-none transition placeholder:text-ta-gray-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 disabled:cursor-not-allowed disabled:bg-ta-gray-100 disabled:text-ta-gray-400";

export const taPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-theme-sm transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:pointer-events-none disabled:opacity-45";

export const taSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ta-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-ta-gray-700 transition hover:bg-ta-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ta-gray-200 disabled:pointer-events-none disabled:opacity-45";

export const taDangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ta-error px-4 py-2.5 text-sm font-semibold text-white shadow-theme-sm transition hover:bg-[#d92d20] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ta-error/25 disabled:pointer-events-none disabled:opacity-45";

export function TaPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

export function TaPageHeader({
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
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-500">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ta-gray-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function TaCard({
  children,
  className,
  title,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-ta-gray-200 bg-white shadow-theme-sm", className)}
    >
      {(title || description) && (
        <div className="border-b border-ta-gray-100 px-5 py-4">
          {title && <h2 className="text-base font-semibold text-ta-gray-900">{title}</h2>}
          {description && <p className="mt-1 text-sm text-ta-gray-500">{description}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function TaStatCard({
  label,
  value,
  icon: Icon,
  tone = "bg-brand-50 text-brand-500",
  compact = false,
}: {
  label: string;
  value: ReactNode;
  icon?: typeof Inbox;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ta-gray-200 bg-white shadow-theme-sm",
        compact ? "p-5 md:p-3" : "p-5",
      )}
    >
      <div className="flex items-center justify-between">
        <p
          className={cn("font-medium text-ta-gray-500", compact ? "text-sm md:text-xs" : "text-sm")}
        >
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "grid place-items-center rounded-lg",
              compact ? "size-9 md:size-7" : "size-9",
              tone,
            )}
          >
            <Icon className={compact ? "size-5 md:size-4" : "size-5"} />
          </span>
        )}
      </div>
      <p
        className={cn(
          "font-bold tracking-tight text-ta-gray-900",
          compact ? "mt-3 text-3xl md:mt-1 md:text-xl" : "mt-3 text-3xl",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function TaField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-ta-gray-700">
      {label}
      {children}
      {hint && <span className="mt-1.5 block text-xs font-normal text-ta-gray-500">{hint}</span>}
    </label>
  );
}

const BADGE_TONES = {
  success: "bg-ta-success/10 text-ta-success",
  danger: "bg-ta-error/10 text-ta-error",
  warning: "bg-ta-warning/10 text-ta-warning",
  info: "bg-brand-50 text-brand-500",
  neutral: "bg-ta-gray-100 text-ta-gray-600",
} as const;

export function TaBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

const NOTICE_TONES = {
  danger: "border-ta-error/30 bg-ta-error/10 text-ta-error",
  warning: "border-ta-warning/30 bg-ta-warning/10 text-ta-warning",
  success: "border-ta-success/30 bg-ta-success/10 text-ta-success",
  neutral: "border-ta-gray-200 bg-ta-gray-50 text-ta-gray-600",
} as const;

export function TaNotice({
  children,
  tone = "neutral",
  role,
}: {
  children: ReactNode;
  tone?: keyof typeof NOTICE_TONES;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium",
        NOTICE_TONES[tone],
      )}
    >
      {tone === "danger" && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function TaLoading({ label = "Memuat data..." }: { label?: string }) {
  return (
    <TaCard>
      <div
        role="status"
        className="flex min-h-48 flex-col items-center justify-center gap-3 text-ta-gray-500"
      >
        <LoaderCircle className="size-6 animate-spin text-brand-500" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </TaCard>
  );
}

export function TaEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-ta-gray-300 bg-ta-gray-25 px-6 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-lg bg-white text-ta-gray-400 shadow-theme-xs ring-1 ring-ta-gray-200">
        <Inbox className="size-5" />
      </span>
      <p className="font-semibold text-ta-gray-800">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ta-gray-500">{description}</p>
    </div>
  );
}

export function TaRetry({ onClick, label = "Coba lagi" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={taSecondaryButtonClass}>
      <RefreshCw className="size-4" />
      {label}
    </button>
  );
}

export function TaPagination({
  page,
  hasNext,
  onPrevious,
  onNext,
  previousLabel = "Sebelumnya",
  nextLabel = "Berikutnya",
}: {
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
}) {
  return (
    <nav
      aria-label="Paginasi"
      className="flex flex-col gap-3 rounded-lg border border-ta-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        disabled={page === 1}
        onClick={onPrevious}
        className={taSecondaryButtonClass}
      >
        {previousLabel}
      </button>
      <span className="text-center text-sm font-semibold text-ta-gray-600">Halaman {page}</span>
      <button type="button" disabled={!hasNext} onClick={onNext} className={taSecondaryButtonClass}>
        {nextLabel}
      </button>
    </nav>
  );
}
